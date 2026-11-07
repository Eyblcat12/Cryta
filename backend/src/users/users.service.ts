import { BadRequestException,ConflictException,ForbiddenException,Inject,Injectable,NotFoundException,UnauthorizedException } from '@nestjs/common'; import { hash } from 'bcryptjs'; import { randomBytes,randomUUID } from 'node:crypto'; import type { Pool,PoolClient } from 'pg'; import type { AuthUser } from '../common/auth-user'; import { DATABASE_POOL } from '../database/database.constants'; import { auditMetadata } from '../audit/audit-context'; import type { CreateUserDto,InviteUserDto,UpdateUserAccessDto,UpdateUserStatusDto,TransferUserDepartmentDto } from './users.dto';
import { isEmail } from 'class-validator';
import { AccountActionsService } from '../auth/account-actions.service';
import { UUID_LIKE } from '../common/uuid-like.pipe';
import { listOrder } from '../common/list-order';
@Injectable()export class UsersService{constructor(@Inject(DATABASE_POOL)private readonly pool:Pool,private readonly accountActions:AccountActionsService){}async list(admin:AuthUser){this.assertAdmin(admin);const result=await this.pool.query(`SELECT u.id,u.email,u.display_name,u.status,u.token_version,u.invitation_pending,u.last_login_at,u.created_at,d.id department_id,d.name department_name,COALESCE(array_agg(DISTINCT r.code)FILTER(WHERE r.code IS NOT NULL),'{}')roles,COALESCE(array_agg(DISTINCT s.department_id::text)FILTER(WHERE s.department_id IS NOT NULL),'{}')scopes FROM users u JOIN departments d ON d.id=u.department_id LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id LEFT JOIN approver_scopes s ON s.user_id=u.id GROUP BY u.id,d.id ORDER BY u.display_name`);return result.rows.map(r=>({id:r.id,email:r.email,displayName:r.display_name,status:r.status,version:r.token_version,invitationPending:r.invitation_pending,lastLoginAt:r.last_login_at,createdAt:r.created_at,departmentId:r.department_id,departmentName:r.department_name,roles:r.roles,approverDepartmentIds:r.scopes}))}
  async listPage(admin:AuthUser,query:Record<string,string>){
    this.assertAdmin(admin);
    const number=(value:string|undefined,fallback:number,max:number)=>{if(value===undefined)return fallback;if(typeof value!=='string'||!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>max)throw new BadRequestException({code:'INVALID_PAGINATION',message:'Tham số phân trang không hợp lệ.'});return Number(value)};
    const page=number(query.page,1,1_000_000),pageSize=number(query.pageSize,25,100);
    const order = listOrder(query, {
      displayName: 'u.display_name', email: 'u.email', createdAt: 'u.created_at', lastLoginAt: 'u.last_login_at', status: 'u.status',
    }, 'u.id', 'u.display_name,u.id');
    if(query.status!==undefined&&typeof query.status!=='string')throw new BadRequestException({code:'INVALID_STATUS',message:'Trạng thái tài khoản không hợp lệ.'});
    if(query.search!==undefined&&typeof query.search!=='string')throw new BadRequestException({code:'INVALID_SEARCH',message:'Từ khóa tìm kiếm không hợp lệ.'});
    const values:unknown[]=[];const filters:string[]=[];
    if(query.userId!==undefined){if(typeof query.userId!=='string'||!UUID_LIKE.test(query.userId))throw new BadRequestException({code:'INVALID_ID',message:'Mã định danh không hợp lệ.'});values.push(query.userId);filters.push(`u.id=$${values.length}::uuid`)}
    if(query.email!==undefined){if(typeof query.email!=='string'||query.email.length>254||!isEmail(query.email.trim()))throw new BadRequestException({code:'INVALID_EMAIL',message:'Email đối chiếu không hợp lệ.'});values.push(query.email.trim().toLowerCase());filters.push(`LOWER(u.email)=$${values.length}`)}
    if(query.status){if(!['ACTIVE','INACTIVE','LOCKED'].includes(query.status))throw new BadRequestException({code:'INVALID_STATUS',message:'Trạng thái tài khoản không hợp lệ.'});values.push(query.status);filters.push(`u.status=$${values.length}`)}
    const search=query.search?.trim();
    if(search){if(search.length>100)throw new BadRequestException({code:'INVALID_SEARCH',message:'Từ khóa tối đa 100 ký tự.'});values.push(`%${search}%`);filters.push(`(u.display_name ILIKE $${values.length} OR u.email ILIKE $${values.length} OR d.name ILIKE $${values.length})`)}
    const where=filters.length?`WHERE ${filters.join(' AND ')}`:'';
    const count=await this.pool.query(`SELECT COUNT(*)::int AS total FROM users u JOIN departments d ON d.id=u.department_id ${where}`,values);
    const args=[...values,pageSize,(page-1)*pageSize];
    const result=await this.pool.query(`SELECT u.id,u.email,u.display_name,u.status,u.token_version,u.invitation_pending,u.last_login_at,u.created_at,d.id department_id,d.name department_name,COALESCE(array_agg(DISTINCT r.code)FILTER(WHERE r.code IS NOT NULL),'{}')roles,COALESCE(array_agg(DISTINCT s.department_id::text)FILTER(WHERE s.department_id IS NOT NULL),'{}')scopes FROM (SELECT u.id FROM users u JOIN departments d ON d.id=u.department_id ${where} ORDER BY ${order} LIMIT $${args.length-1} OFFSET $${args.length}) page_ids JOIN users u ON u.id=page_ids.id JOIN departments d ON d.id=u.department_id LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id LEFT JOIN approver_scopes s ON s.user_id=u.id GROUP BY u.id,d.id ORDER BY ${order}`,args);
    return{items:result.rows.map(r=>({id:r.id,email:r.email,displayName:r.display_name,status:r.status,version:r.token_version,invitationPending:r.invitation_pending,lastLoginAt:r.last_login_at,createdAt:r.created_at,departmentId:r.department_id,departmentName:r.department_name,roles:r.roles,approverDepartmentIds:r.scopes})),total:Number(count.rows[0]?.total??0),page,pageSize};
  }
  async reference(admin:AuthUser){this.assertAdmin(admin);const[d,r]=await Promise.all([this.pool.query(`SELECT id,code,name FROM departments WHERE is_active=TRUE ORDER BY name`),this.pool.query(`SELECT code,name FROM roles ORDER BY name`)]);return{departments:d.rows,roles:r.rows}}
  async create(admin:AuthUser,dto:CreateUserDto){
    return this.createAccount(admin,dto,dto.temporaryPassword);
  }

  async invite(admin:AuthUser,dto:InviteUserDto){
    this.assertAdmin(admin);
    this.accountActions.requireEnabled();
    return this.createAccount(admin,dto);
  }

  private async createAccount(admin:AuthUser,dto:InviteUserDto,temporaryPassword?:string){
    this.assertAdmin(admin);
    if(dto.roles.includes('ADMIN')&&dto.roles.includes('APPROVER')){
      throw new ConflictException({code:'SOD_ROLE_CONFLICT',message:'Một tài khoản không thể đồng thời là Admin và Approver.'});
    }
    const displayName=dto.displayName.trim();
    if(displayName.length<2)throw new BadRequestException({code:'USER_NAME_INVALID',message:'Tên hiển thị phải có ít nhất hai ký tự.'});
    const email=dto.email.trim().toLowerCase();
    const invitationPending=temporaryPassword===undefined;
    const status=invitationPending?'INACTIVE':'ACTIVE';
    const passwordHash=await hash(temporaryPassword??randomBytes(48).toString('base64url'),12);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await this.lockAdministration(client,admin);
      const id=randomUUID();
      await this.assertActiveDepartment(client,dto.departmentId);
      await client.query(`INSERT INTO users(id,department_id,email,password_hash,display_name,status,must_change_password,invitation_pending)
        VALUES($1,$2,$3,$4,$5,$6,TRUE,$7)`,[id,dto.departmentId,email,passwordHash,displayName,status,invitationPending]);
      await this.replaceAccess(client,id,dto.roles,dto.approverDepartmentIds,admin.id);
      await this.audit(client,admin.id,invitationPending?'USER_INVITED':'USER_CREATED',id,{roles:dto.roles});
      if(invitationPending)await this.accountActions.issue(client,id,1,'INVITATION');
      await client.query('COMMIT');
      return{id,email,displayName,status,roles:dto.roles,mustChangePassword:true,invitationPending};
    }catch(error){
      await client.query('ROLLBACK');
      if((error as {code?:string})?.code==='23505')throw new ConflictException({code:'EMAIL_EXISTS',message:'Email đã được sử dụng.'});
      throw error;
    }finally{client.release()}
  }

  async resendInvitation(admin:AuthUser,id:string){
    this.assertAdmin(admin);
    this.accountActions.requireEnabled();
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await this.lockAdministration(client,admin);
      const user=(await client.query<{status:string;invitation_pending:boolean;token_version:number}>(
        'SELECT status,invitation_pending,token_version FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!user)throw new NotFoundException({code:'USER_NOT_FOUND',message:'Không tìm thấy người dùng.'});
      if(!user.invitation_pending||user.status!=='INACTIVE'){
        throw new ConflictException({code:'INVITATION_NOT_PENDING',message:'Tài khoản không ở trạng thái chờ lời mời.'});
      }
      const recent=await client.query(`SELECT 1 FROM account_actions WHERE user_id=$1 AND purpose='INVITATION'
        AND created_at>clock_timestamp()-INTERVAL '1 minute' AND token_version=$2`,[id,user.token_version]);
      if(recent.rowCount)throw new ConflictException({code:'INVITATION_RECENTLY_QUEUED',message:'Lời mời vừa được đưa vào hàng đợi. Hãy đợi một phút trước khi gửi lại.'});
      await this.accountActions.issue(client,id,user.token_version,'INVITATION');
      await this.audit(client,admin.id,'USER_INVITATION_REISSUED',id,{});
      await client.query('COMMIT');
      return{id,invitationPending:true,queued:true};
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }

  async status(admin:AuthUser,id:string,dto:UpdateUserStatusDto){this.assertAdmin(admin);if(admin.id===id&&dto.status!=='ACTIVE')throw new ConflictException({code:'CANNOT_DISABLE_SELF',message:'Bạn không thể vô hiệu hóa tài khoản đang đăng nhập.'});const client=await this.pool.connect();try{await client.query('BEGIN');await this.lockAdministration(client,admin);const found=await client.query<{invitation_pending:boolean}>('SELECT id,invitation_pending FROM users WHERE id=$1 FOR UPDATE',[id]);if(!found.rowCount)throw new NotFoundException({code:'USER_NOT_FOUND',message:'Không tìm thấy người dùng.'});if(dto.status==='ACTIVE'&&found.rows[0]?.invitation_pending)throw new ConflictException({code:'INVITATION_PENDING',message:'Người nhận cần chấp nhận lời mời trước khi kích hoạt tài khoản.'});if(dto.status!=='ACTIVE')await this.assertAnotherActiveAdmin(client,id);else await this.assertUserDepartmentActive(client,id);const result=await client.query(`UPDATE users SET status=$2,token_version=token_version+1,locked_until=NULL,failed_login_attempts=0 WHERE id=$1 RETURNING id,email,display_name,status`,[id,dto.status]);await client.query(`UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE user_id=$1`,[id]);await this.audit(client,admin.id,'USER_STATUS_CHANGED',id,{status:dto.status});await client.query('COMMIT');return{id:result.rows[0].id,email:result.rows[0].email,displayName:result.rows[0].display_name,status:result.rows[0].status}}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  async access(admin:AuthUser,id:string,dto:UpdateUserAccessDto){this.assertAdmin(admin);if(dto.roles.includes('ADMIN')&&dto.roles.includes('APPROVER'))throw new ConflictException({code:'SOD_ROLE_CONFLICT',message:'Một tài khoản không thể đồng thời là Admin và Approver.'});const client=await this.pool.connect();try{await client.query('BEGIN');await this.lockAdministration(client,admin);if(!(await client.query('SELECT 1 FROM users WHERE id=$1 FOR UPDATE',[id])).rowCount)throw new NotFoundException({code:'USER_NOT_FOUND',message:'Không tìm thấy người dùng.'});if(!dto.roles.includes('ADMIN'))await this.assertAnotherActiveAdmin(client,id);await client.query('DELETE FROM approver_scopes WHERE user_id=$1',[id]);await client.query('DELETE FROM user_roles WHERE user_id=$1',[id]);await this.replaceAccess(client,id,dto.roles,dto.approverDepartmentIds,admin.id);await client.query('UPDATE users SET token_version=token_version+1 WHERE id=$1',[id]);await client.query(`UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE user_id=$1`,[id]);await this.audit(client,admin.id,'USER_ACCESS_CHANGED',id,{roles:dto.roles,scopes:dto.approverDepartmentIds});await client.query('COMMIT');return{updated:true}}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  async lockAdministration(client:PoolClient,admin:AuthUser){
    this.assertAdmin(admin);
    await this.lockUserAdministration(client);
    await this.assertCurrentAdministrator(client,admin);
  }
  async transferDepartment(admin:AuthUser,id:string,dto:TransferUserDepartmentDto){
    this.assertAdmin(admin);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');await this.lockAdministration(client,admin);
      const row=(await client.query<{department_id:string;token_version:number}>(
        'SELECT department_id,token_version FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!row)throw new NotFoundException({code:'USER_NOT_FOUND',message:'Không tìm thấy người dùng.'});
      if(row.token_version!==dto.version)throw new ConflictException({code:'VERSION_CONFLICT',message:'Tài khoản đã thay đổi. Hãy tải lại trước khi chuyển đơn vị.'});
      const departmentId=dto.departmentId.toLowerCase();
      await this.assertActiveDepartment(client,departmentId);
      if(row.department_id===departmentId){await client.query('COMMIT');return{updated:false,departmentId:row.department_id,version:row.token_version}}
      await client.query('UPDATE users SET department_id=$2,token_version=token_version+1 WHERE id=$1',[id,departmentId]);
      await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE user_id=$1',[id]);
      await this.audit(client,admin.id,'USER_DEPARTMENT_CHANGED',id,{previousDepartmentId:row.department_id,departmentId});
      await client.query('COMMIT');return{updated:true,departmentId,version:row.token_version+1};
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  private async assertActiveDepartment(client:PoolClient,id:string){
    if(!(await client.query('SELECT id FROM departments WHERE id=$1 AND is_active=TRUE FOR SHARE',[id])).rowCount){
      throw new ConflictException({code:'INVALID_DEPARTMENT',message:'Đơn vị không tồn tại hoặc đã ngừng hoạt động.'});
    }
  }
  private async assertUserDepartmentActive(client:PoolClient,id:string){
    if(!(await client.query(`SELECT d.id FROM departments d JOIN users u ON u.department_id=d.id
      WHERE u.id=$1 AND d.is_active=TRUE FOR SHARE OF d`,[id])).rowCount){
      throw new ConflictException({code:'INVALID_DEPARTMENT',message:'Hãy chuyển tài khoản sang đơn vị đang hoạt động trước khi kích hoạt.'});
    }
  }
  private async assertCurrentAdministrator(client:PoolClient,admin:AuthUser){
    // The HTTP guard ran before this transaction could wait for the administration lock.
    // Recheck after that wait and lock the actor until this mutation commits.
    const result=await client.query(`SELECT u.status,u.token_version,EXISTS(
      SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='ADMIN'
    ) AS is_admin FROM users u WHERE u.id=$1 FOR UPDATE OF u`,[admin.id]);
    const actor=result.rows[0];
    if(!actor||actor.status!=='ACTIVE'||!actor.is_admin||actor.token_version!==admin.tokenVersion){
      throw new UnauthorizedException({code:'SESSION_REVOKED',message:'Phiên đăng nhập đã bị thu hồi.'});
    }
  }
  private async lockUserAdministration(client:PoolClient){
    // Acquire before target rows: actor/assigned_by audit FKs may lock another Admin.
    // Taking this after a row lock lets two Admins removing each other deadlock.
    await client.query('SELECT pg_advisory_xact_lock(17232,1)');
  }
  private async assertAnotherActiveAdmin(client:PoolClient,targetId:string){
    // The caller holds the administration lock before acquiring any user row lock.
    const target=await client.query(`SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.id=$1 AND u.status='ACTIVE' AND r.code='ADMIN'`,[targetId]);
    if(!target.rowCount)return;
    const remaining=await client.query(`SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.id<>$1 AND u.status='ACTIVE' AND r.code='ADMIN' LIMIT 1`,[targetId]);
    if(!remaining.rowCount)throw new ConflictException({code:'LAST_ACTIVE_ADMIN',message:'Hệ thống phải còn ít nhất một quản trị viên đang hoạt động.'});
  }
  private async replaceAccess(client:PoolClient,userId:string,roles:string[],scopes:string[],adminId:string){
    if(userId===adminId&&!roles.includes('ADMIN'))throw new ConflictException({code:'CANNOT_REMOVE_OWN_ADMIN',message:'Bạn không thể tự gỡ quyền quản trị của mình.'});
    if(roles.includes('APPROVER')&&!scopes.length)throw new ConflictException({code:'APPROVER_SCOPE_REQUIRED',message:'Người phê duyệt cần ít nhất một phòng ban trong phạm vi.'});
    if(!roles.includes('APPROVER')&&scopes.length)throw new ConflictException({code:'SCOPE_ROLE_MISMATCH',message:'Chỉ người phê duyệt được gán phạm vi.'});
    const uniqueScopes=[...new Set(scopes)];
    if(uniqueScopes.length){const valid=await client.query('SELECT id FROM departments WHERE is_active=TRUE AND id=ANY($1::uuid[])',[uniqueScopes]);if(valid.rowCount!==uniqueScopes.length)throw new ConflictException({code:'INVALID_DEPARTMENT_SCOPE',message:'Phạm vi có phòng ban không tồn tại hoặc ngừng hoạt động.'});}
    await client.query(`INSERT INTO user_roles(user_id,role_id,assigned_by)SELECT $1,id,$3 FROM roles WHERE code=ANY($2::text[])`,[userId,[...new Set(roles)],adminId]);if(roles.includes('APPROVER'))await client.query(`INSERT INTO approver_scopes(user_id,department_id,assigned_by)SELECT $1,UNNEST($2::uuid[]),$3`,[userId,uniqueScopes,adminId]);
  }
  private audit(client:PoolClient,actorId:string,action:string,id:string,metadata:unknown){return client.query(`INSERT INTO audit_logs(actor_id,actor_type,action,entity_type,entity_id,outcome,metadata)VALUES($1,'USER',$2,'USER',$3::text,'SUCCESS',$4::jsonb)`,[actorId,action,id,JSON.stringify(auditMetadata(metadata))])}private assertAdmin(user:AuthUser){if(!user.roles.includes('ADMIN'))throw new ForbiddenException({code:'ADMIN_REQUIRED',message:'Chỉ Security Admin được quản trị người dùng.'})}}
