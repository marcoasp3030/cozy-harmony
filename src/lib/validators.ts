export interface PhoneValidationResult {
  valid: boolean;
  formatted: string;
  error?: string;
}

export const validatePhone = (phone: string): PhoneValidationResult => {
  if (!phone || typeof phone !== "string") {
    return { valid: false, formatted: "", error: "Número vazio" };
  }

  let cleaned = String(phone).replace(/\D/g, "");

  // Add country code if missing
  if (cleaned.length === 10 || cleaned.length === 11) {
    cleaned = "55" + cleaned;
  }

  // Validate BR format: 55 + 2 digit DDD + 8-9 digit number
  if (!/^55\d{10,11}$/.test(cleaned)) {
    return { valid: false, formatted: cleaned, error: "Formato inválido" };
  }

  return { valid: true, formatted: cleaned };
};

export const formatPhoneDisplay = (phone: string): string => {
  const match = phone.match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  if (match) return `+${match[1]} (${match[2]}) ${match[3]}-${match[4]}`;
  return phone;
};
