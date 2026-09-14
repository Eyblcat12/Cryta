import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';

type Job = { id:string; type:string; recipient_email:string; recipient_name:string; request_id:string|null; asset_id:string|null };

@Injectable()
export class EmailWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger=new Logger(EmailWorkerService.name); private timer?:NodeJS.Timeout; private running=false; private transporter?:Transporter;
  constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
  async onModuleInit(){
    if(process.env.SMTP_ENABLED!=='true'){this.logger.warn('SMTP đang tắt; đặt SMTP_ENABLED=true để gửi email thật.');return;}
    this.transporter=nodemailer.createTransport({host:this.required('SMTP_HOST'),port:Number(process.env.SMTP_PORT??587),secure:process.env.SMTP_SECURE==='true',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:this.required('SMTP_PASSWORD')}:undefined,connectionTimeout:10_000,socketTimeout:20_000});
    await this.transporter.verify(); this.logger.log('Kết nối SMTP đã được xác minh.');
    await this.pool.query(`UPDATE notifications SET delivery_status='PENDING',scheduled_for=NOW() WHERE delivery_status='SENDING' AND scheduled_for<NOW()-INTERVAL '10 minutes'`);
    this.timer=setInterval(()=>void this.processBatch(),10_000); void this.processBatch();
  }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer)}
  async sendTest(to:string){if(!this.transporter)throw new ServiceUnavailableException({code:'SMTP_DISABLED',message:'SMTP chưa được bật hoặc chưa kết nối. Hãy kiểm tra cấu hình SMTP_* rồi khởi động lại hệ thống.'});await this.transporter.sendMail({from:this.from(),to,subject:'Crypta - Kiểm tra cấu hình email',text:'Cấu hình SMTP của Crypta đang hoạt động.',html:'<p>Cấu hình SMTP của <strong>Crypta</strong> đang hoạt động.</p>'});return{sent:true,to}}
  private async processBatch(){if(this.running||!this.transporter)return;this.running=true;try{for(let i=0;i<10;i++){const job=await this.claim();if(!job)break;await this.deliver(job)}}catch(error){this.logger.error('Email worker gặp lỗi',error instanceof Error?error.stack:String(error))}finally{this.running=false}}
  private async claim():Promise<Job|undefined>{const client=await this.pool.connect();try{await client.query('BEGIN');const found=await client.query<Job>(`SELECT n.id,n.type,n.request_id,n.asset_id,u.email AS recipient_email,u.display_name AS recipient_name FROM notifications n JOIN users u ON u.id=n.recipient_id WHERE n.channel='EMAIL' AND n.delivery_status='PENDING' AND n.scheduled_for<=NOW() ORDER BY n.scheduled_for FOR UPDATE SKIP LOCKED LIMIT 1`);const job=found.rows[0];if(job)await client.query(`UPDATE notifications SET delivery_status='SENDING',attempt_count=attempt_count+1 WHERE id=$1`,[job.id]);await client.query('COMMIT');return job}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  private async deliver(job:Job){try{const message=this.message(job);await this.transporter!.sendMail({from:this.from(),to:job.recipient_email,subject:message.subject,text:message.text,html:message.html});await this.pool.query(`UPDATE notifications SET delivery_status='SENT',sent_at=NOW(),error_message=NULL WHERE id=$1`,[job.id])}catch(error){const msg=(error instanceof Error?error.message:String(error)).slice(0,1000);await this.pool.query(`UPDATE notifications SET delivery_status=CASE WHEN attempt_count>=5 THEN 'FAILED' ELSE 'PENDING' END,failed_at=CASE WHEN attempt_count>=5 THEN NOW() ELSE NULL END,scheduled_for=NOW()+(LEAST(attempt_count,5)*INTERVAL '2 minutes'),error_message=$2 WHERE id=$1`,[job.id,msg]);this.logger.warn(`Không gửi được email ${job.id}: ${msg}`)}}
  private message(job:Job){const name=this.escape(job.recipient_name);const id=this.escape(job.request_id??job.asset_id??'');const labels:Record<string,string>={REQUEST_SUBMITTED:'Yêu cầu mới cần phê duyệt',REQUEST_APPROVED:'Yêu cầu đã được phê duyệt',REQUEST_REJECTED:'Yêu cầu đã bị từ chối',ASSET_EXPIRING:'Tài sản sắp hết hạn',ASSET_EXPIRED:'Tài sản đã hết hạn',ASSET_REVOKED:'Tài sản đã bị thu hồi'};const subject=`Crypta - ${labels[job.type]??'Thông báo hệ thống'}`;const text=`Xin chào ${job.recipient_name},\n\n${labels[job.type]??'Có cập nhật mới'}: ${job.request_id??job.asset_id??''}.\nVui lòng đăng nhập Crypta để xem chi tiết.\n\nKhông trả lời email tự động này.`;return{subject,text,html:`<div style="font-family:Arial,sans-serif;max-width:600px"><h2 style="color:#f05a28">Crypta</h2><p>Xin chào ${name},</p><p><strong>${this.escape(labels[job.type]??'Có cập nhật mới')}</strong></p><p>Mã tham chiếu: <code>${id}</code></p><p>Vui lòng đăng nhập Crypta để xem chi tiết.</p><hr><small>Không trả lời email tự động này.</small></div>`}}
  private required(key:string){const value=process.env[key];if(!value)throw new Error(`${key} is required when SMTP_ENABLED=true`);return value}
  private from(){return process.env.SMTP_FROM??'Crypta <no-reply@example.com>'}
  private escape(value:string){return value.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!))}
}
