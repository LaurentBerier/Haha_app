function normalizeAccountType(accountType) {
  if (typeof accountType === 'string' && accountType.trim()) {
    const normalized = accountType.trim().toLowerCase();
    if (normalized === 'free' || normalized === 'regular' || normalized === 'premium' || normalized === 'admin') {
      return normalized;
    }

    const compact = normalized.replace(/[\s_-]+/g, '');
    if (compact === 'unlimited') {
      return 'regular';
    }
    if (compact === 'proartist') {
      return 'premium';
    }
  }

  return 'free';
}

function isAdminRole(role) {
  return typeof role === 'string' && role.trim().toLowerCase() === 'admin';
}

function resolveEffectiveAccountType(accountType, role) {
  if (isAdminRole(role)) {
    return 'admin';
  }

  return normalizeAccountType(accountType);
}

module.exports = {
  normalizeAccountType,
  isAdminRole,
  resolveEffectiveAccountType
};
