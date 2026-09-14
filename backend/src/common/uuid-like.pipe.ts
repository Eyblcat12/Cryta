import { BadRequestException,Injectable,PipeTransform } from '@nestjs/common';
export const UUID_LIKE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
@Injectable() export class UuidLikePipe implements PipeTransform<string,string>{transform(value:string){if(!UUID_LIKE.test(value))throw new BadRequestException({code:'INVALID_ID',message:'Mã định danh không hợp lệ.'});return value}}
