export const formatWhatsAppNumber = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('92') && digits.length === 12) {
    return `+92 ${digits.slice(2, 5)} ${digits.slice(5)}`;
  }
  if (digits.startsWith('44') && digits.length === 12) {
    return `+44 ${digits.slice(2, 6)} ${digits.slice(6)}`;
  }
  return value || '';
};
