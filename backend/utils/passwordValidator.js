import Filter from 'bad-words';
const filter = new Filter();

/**
 * Validate password strength and check against dictionary
 * Returns { valid: boolean, error: string }
 */
function validatePassword(password) {
  // Check length
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }

  // Check for uppercase
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }

  // Check for lowercase
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }

  // Check for number
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }

  // Check for special character
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one special character' };
  }

  // Check against common bad words/dictionary words
  const lowerPassword = password.toLowerCase();
  
  // Common weak passwords
  // cspell: disable-next-line
  const commonPasswords = [
    'password', 'password123', '12345678', 'qwerty', 'abc123', 
    'monkey', 'letmein', 'trustno1', 'dragon', 'baseball',
    'iloveyou', 'master', 'sunshine', 'ashley', 'bailey'
  ];

  for (const common of commonPasswords) {
    if (lowerPassword.includes(common)) {
      return { valid: false, error: 'Password contains common words or patterns' };
    }
  }

  // Use bad-words filter to check for profanity
  if (filter.isProfane(password)) {
    return { valid: false, error: 'Password contains inappropriate words' };
  }

  return { valid: true };
}

export { validatePassword };
