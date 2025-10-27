export const LANGUAGES = [
  { value: 'bn', label: 'Bengali' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh-Hant', label: 'Traditional Chinese' },
  { value: 'zh-Hans', label: 'Simplified Chinese' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'es', label: 'Spanish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'el', label: 'Greek' }
]

export function getLanguageLabel (value) {
  const match = LANGUAGES.find(lang => lang.value === value)
  return match ? match.label : value
}

export function resolveLanguageValue (lang = '') {
  if (!lang) return 'en'
  if (LANGUAGES.some(item => item.value === lang)) return lang
  const normalized = lang.toLowerCase()
  const direct = LANGUAGES.find(item => item.value.toLowerCase() === normalized)
  if (direct) return direct.value
  const shorthand = normalized.split('-')[0]
  const prefix = LANGUAGES.find(item => item.value.toLowerCase() === shorthand)
  return prefix ? prefix.value : 'en'
}
