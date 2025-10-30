export async function translateText ({ text, targetLanguage }) {
  if (!text || !targetLanguage || typeof Translator?.create !== 'function') {
    throw new Error('Translator API unavailable')
  }

  const translator = await Translator.create({
    sourceLanguage: 'en',
    targetLanguage
  })

  const result = await translator.translate(text)
  if (typeof result !== 'string') {
    return String(result ?? '')
  }
  return result
}
