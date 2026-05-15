export function registrationErrorMessage(error: unknown): string {
  const code = extractApiCode(error);
  if (code === 'already_registered') {
    return 'Bạn đã đăng ký workshop này rồi. Vào "Đăng ký của tôi" để xem QR hoặc trạng thái thanh toán.';
  }
  if (code === 'sold_out') {
    return 'Workshop này vừa hết chỗ. Hãy chọn workshop khác còn ghế.';
  }
  if (code === 'registration_in_progress') {
    return 'Yêu cầu đăng ký trước đó đang được xử lý. Chờ vài giây rồi vào "Đăng ký của tôi" kiểm tra.';
  }
  return extractApiMessage(error) ?? 'Đăng ký thất bại. Vui lòng thử lại hoặc chọn workshop khác.';
}

function extractApiCode(error: unknown): string | undefined {
  const response = (error as { response?: { data?: { code?: unknown } } }).response;
  return typeof response?.data?.code === 'string' ? response.data.code : undefined;
}

function extractApiMessage(error: unknown): string | undefined {
  const axError = error as { response?: { data?: { message?: unknown } }; message?: unknown };
  if (typeof axError.response?.data?.message === 'string') return axError.response.data.message;
  if (typeof axError.message === 'string') return axError.message;
  if (typeof error === 'string') return error;
  return undefined;
}
