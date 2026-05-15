import assert from 'node:assert/strict';
import { registrationErrorMessage } from '../src/lib/registrationError.ts';

assert.equal(
  registrationErrorMessage({ response: { data: { code: 'already_registered' } } }),
  'Bạn đã đăng ký workshop này rồi. Vào "Đăng ký của tôi" để xem QR hoặc trạng thái thanh toán.',
);

assert.equal(
  registrationErrorMessage({ response: { data: { code: 'sold_out' } } }),
  'Workshop này vừa hết chỗ. Hãy chọn workshop khác còn ghế.',
);

assert.equal(
  registrationErrorMessage({ response: { data: { code: 'registration_in_progress' } } }),
  'Yêu cầu đăng ký trước đó đang được xử lý. Chờ vài giây rồi vào "Đăng ký của tôi" kiểm tra.',
);

console.log('registration error message tests passed');
