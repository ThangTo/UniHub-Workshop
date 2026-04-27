import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { v4 as uuid } from 'uuid';
import { JwksService } from '../auth/jwks.service';

export interface QrTokenPayload {
  regId: string;
  workshopId: string;
  studentId: string;
  validFrom: number; // unix seconds
  validTo: number;
  jti: string;
}

/**
 * QR Token = JWT RS256 (specs/registration.md §E).
 * Mobile có public key sẽ verify offline.
 */
@Injectable()
export class QrTokenService {
  constructor(private readonly jwks: JwksService) {}

  sign(input: {
    regId: string;
    workshopId: string;
    studentId: string;
    startAt: Date;
    endAt: Date;
  }): string {
    const validFrom = Math.floor((input.startAt.getTime() - 60 * 60 * 1000) / 1000);
    const validTo = Math.floor((input.endAt.getTime() + 60 * 60 * 1000) / 1000);
    const payload: QrTokenPayload = {
      regId: input.regId,
      workshopId: input.workshopId,
      studentId: input.studentId,
      validFrom,
      validTo,
      jti: uuid(),
    };
    return this.jwks.signRs256(payload, {
      expiresIn: validTo - Math.floor(Date.now() / 1000),
    });
  }

  verify(token: string): QrTokenPayload {
    return this.jwks.verifyRs256<QrTokenPayload>(token);
  }

  async toDataUrl(token: string): Promise<string> {
    return QRCode.toDataURL(token, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
  }
}
