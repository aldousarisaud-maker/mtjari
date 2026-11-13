import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@mtjari/db';
import type { Response } from 'express';

/** Map well-known Prisma errors to HTTP responses without leaking SQL detail. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaErrorsFilter implements ExceptionFilter {
  private readonly logger = new Logger('PrismaErrors');

  catch(err: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (err.code === 'P2002') {
      res.status(HttpStatus.CONFLICT).json({ statusCode: 409, error: 'conflict', message: 'already_exists' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, error: 'not_found', message: 'not_found' });
      return;
    }
    this.logger.error(`Unhandled Prisma error ${err.code}: ${err.message.split("\n").slice(-3).join(" ")}`);
    res.status(500).json({ statusCode: 500, error: 'internal_error', message: 'internal_error' });
  }
}
