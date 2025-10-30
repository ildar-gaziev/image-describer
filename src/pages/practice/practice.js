import { getCards } from '../../shared/cards.js'
import { getLanguageLabel, LANGUAGES } from '../../shared/languages.js'
import { translateText } from '../../shared/translate.js'

const cardImage = document.getElementById('cardImage')
const practiceText = document.getElementById('practiceText')
const langLabel = document.getElementById('langLabel')
const voiceSelect = document.getElementById('voiceSelect')
const playButton = document.getElementById('playButton')
const pauseButton = document.getElementById('pauseButton')
const stopButton = document.getElementById('stopButton')
const statusEl = document.getElementById('status')
const backButton = document.getElementById('backButton')
const hideTextButton = document.getElementById('hideTextButton')
const recordButton = document.getElementById('recordButton')
const recitationSection = document.getElementById('recitationResults')
const transcriptionEl = document.getElementById('transcription')
const analysisEl = document.getElementById('analysis')
const analysisTranslationSection = document.getElementById('analysisTranslation')
const analysisTranslateSelect = document.getElementById('analysisTranslateSelect')
const analysisTranslatedText = document.getElementById('analysisTranslatedText')

let card = null
let voices = []
let utterance = null
let currentVoice = null
let suppressNextError = false
let recognition = null
let isRecording = false
let hiddenText = false
let recordedTranscript = ''
let analysisResult = { accuracy: null, feedback: '' }
let currentAnalysisTranslationLang = ''

function setStatus (message) {
  statusEl.textContent = message || ''
}

function getDisplayedText () {
  return hiddenText
    ? practiceText.dataset.currentText || practiceText.getAttribute('data-full-text') || ''
    : practiceText.textContent || practiceText.dataset.currentText || ''
}

function getCardIdFromHash () {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return params.get('cardId') || ''
}

function mapRecognitionLocale (lang) {
  const normalized = (lang || '').toLowerCase()
  switch (normalized) {
    case 'en':
      return 'en-US'
    case 'es':
      return 'es-ES'
    case 'fr':
      return 'fr-FR'
    case 'de':
      return 'de-DE'
    case 'pt':
      return 'pt-PT'
    case 'ru':
      return 'ru-RU'
    case 'ja':
      return 'ja-JP'
    case 'hi':
      return 'hi-IN'
    case 'bn':
      return 'bn-IN'
    case 'tr':
      return 'tr-TR'
    case 'vi':
      return 'vi-VN'
    case 'el':
      return 'el-GR'
    case 'zh':
    case 'zh-hans':
    case 'zh-cn':
      return 'zh-CN'
    case 'zh-hant':
    case 'zh-tw':
      return 'zh-TW'
    case 'zh-hk':
      return 'zh-HK'
    default: {
      if (!normalized) return 'en-US'
      const parts = normalized.split('-')
      if (parts.length > 1) return `${parts[0]}-${parts[1].toUpperCase()}`
      return `${parts[0]}-${parts[0].toUpperCase()}`
    }
  }
}

function cancelSpeech () {
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    suppressNextError = true
    window.speechSynthesis.cancel()
  }
  utterance = null
  playButton.disabled = false
  pauseButton.disabled = true
  stopButton.disabled = true
}

function pauseSpeech () {
  if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
    window.speechSynthesis.pause()
    pauseButton.disabled = true
    playButton.disabled = false
    setStatus('Paused')
  }
}

function resumeSpeech () {
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume()
    pauseButton.disabled = false
    playButton.disabled = true
    setStatus('Playing')
  }
}

function populateVoices (lang) {
  voices = window.speechSynthesis.getVoices()
  if (!voiceSelect) return

  voiceSelect.innerHTML = ''

  if (!voices.length) {
    const opt = document.createElement('option')
    opt.textContent = 'Voices unavailable'
    opt.disabled = true
    opt.selected = true
    voiceSelect.appendChild(opt)
    voiceSelect.disabled = true
    return
  }

  const normalizedLang = (lang || '').toLowerCase()
  let filtered = voices
  if (normalizedLang.startsWith('en')) {
    filtered = voices.filter(voice => (voice.lang || '').toLowerCase().startsWith('en'))
  } else if (normalizedLang.startsWith('zh-hans')) {
    filtered = voices.filter(voice => {
      const voiceLang = (voice.lang || '').toLowerCase()
      return voiceLang.startsWith('zh-cn') || voiceLang.startsWith('zh-hans')
    })
  } else if (normalizedLang.startsWith('zh-hant')) {
    filtered = voices.filter(voice => {
      const voiceLang = (voice.lang || '').toLowerCase()
      return (
        voiceLang.startsWith('zh-hk') ||
        voiceLang.startsWith('zh-tw') ||
        voiceLang.startsWith('zh-hant')
      )
    })
  } else if (normalizedLang) {
    filtered = voices.filter(voice => {
      const voiceLang = (voice.lang || '').toLowerCase()
      return voiceLang.startsWith(normalizedLang)
    })
  }

  if (!filtered.length) {
    filtered = voices.filter(voice =>
      (voice.lang || '').toLowerCase().startsWith(normalizedLang.split('-')[0])
    )
  }

  const list = filtered.length ? filtered : voices
  voiceSelect.disabled = false

  for (const voice of list) {
    const option = document.createElement('option')
    option.value = voice.voiceURI
    option.textContent = `${voice.name} (${voice.lang})`
    if (voice.default) option.selected = true
    voiceSelect.appendChild(option)
  }

  currentVoice = list.find(voice => voice.default) || list[0] || voices[0] || null
  if (currentVoice) {
    voiceSelect.value = currentVoice.voiceURI
  }
}

function speakText (text, lang) {
  cancelSpeech()

  if (!text) {
    setStatus('Nothing to play.')
    return
  }

  if (!voices.length) {
    populateVoices(lang)
    if (!voices.length) {
      setStatus('Speech synthesis voices are unavailable in this browser.')
      return
    }
  }

  const resolvedLang = lang || 'en'
  const normalized = resolvedLang.toLowerCase()
  utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1
  utterance.pitch = 1

  let appliedVoice = currentVoice || null
  const matchVoice = predicate =>
    voices.find(voice => predicate((voice.lang || '').toLowerCase()))

  if (!appliedVoice) {
    appliedVoice = matchVoice(voiceLang => voiceLang.startsWith(normalized))

    if (!appliedVoice && normalized.startsWith('zh-hans')) {
      appliedVoice = matchVoice(voiceLang =>
        voiceLang.startsWith('zh-cn') || voiceLang.startsWith('zh-hans')
      )
    }

    if (!appliedVoice && normalized.startsWith('zh-hant')) {
      appliedVoice = matchVoice(voiceLang =>
        voiceLang.startsWith('zh-hk') ||
        voiceLang.startsWith('zh-tw') ||
        voiceLang.startsWith('zh-hant')
      )
    }

    if (!appliedVoice && normalized.startsWith('en')) {
      appliedVoice = matchVoice(voiceLang => voiceLang.startsWith('en'))
    }

    if (!appliedVoice) {
      const baseLang = normalized.split('-')[0]
      appliedVoice = matchVoice(voiceLang => voiceLang.startsWith(baseLang))
    }

    if (!appliedVoice) {
      appliedVoice = voices[0] || null
    }
  }

  if (appliedVoice) {
    utterance.voice = appliedVoice
    utterance.lang = appliedVoice.lang || resolvedLang || 'en'
    currentVoice = appliedVoice
    const hasOption = Array.from(voiceSelect?.options || []).some(
      option => option.value === appliedVoice.voiceURI
    )
    if (hasOption && voiceSelect) {
      voiceSelect.value = appliedVoice.voiceURI
    }
  } else {
    utterance.lang = resolvedLang || 'en'
  }

  if (!utterance.lang) utterance.lang = 'en'

  utterance.onstart = () => {
    suppressNextError = false
    setStatus('Playing')
    playButton.disabled = true
    pauseButton.disabled = false
    stopButton.disabled = false
  }

  utterance.onpause = () => {
    setStatus('Paused')
    playButton.disabled = false
    pauseButton.disabled = true
  }

  utterance.onresume = () => {
    setStatus('Playing')
    playButton.disabled = true
    pauseButton.disabled = false
  }

  utterance.onend = () => {
    suppressNextError = false
    setStatus('Finished')
    playButton.disabled = false
    pauseButton.disabled = true
    stopButton.disabled = true
  }

  utterance.onerror = event => {
    if (suppressNextError && (event.error === 'interrupted' || event.error === 'canceled')) {
      suppressNextError = false
      return
    }
    suppressNextError = false
    console.error('Speech error', event.error)
    setStatus('Speech synthesis failed. Try selecting a different voice.')
    playButton.disabled = false
    pauseButton.disabled = true
    stopButton.disabled = true
  }

  window.speechSynthesis.speak(utterance)
}

function updatePracticeCard () {
  if (!card) {
    setStatus('Card not found.')
    practiceText.textContent = ''
    cardImage.hidden = true
    return
  }

  const lang = card.targetLanguage || 'en'
  langLabel.textContent = `Language: ${getLanguageLabel(lang)}`

  const text =
    card.translations?.[lang] ||
    (lang === 'en' ? card.descriptionEn : card.descriptionEn || '')

  const fallbackText = 'No description available.'
  const displayText = text || fallbackText
  if (hiddenText) {
    practiceText.setAttribute('data-full-text', displayText)
    practiceText.textContent = '••••••'
  } else {
    practiceText.textContent = displayText
    practiceText.removeAttribute('data-full-text')
  }

  practiceText.dataset.currentText = displayText
  if (hideTextButton) {
    hideTextButton.textContent = hiddenText ? '👁️' : '🙈'
    hideTextButton.title = hiddenText ? 'Show original text' : 'Hide text'
  }
  if (recitationSection) recitationSection.hidden = true
  if (transcriptionEl) transcriptionEl.textContent = ''
  if (analysisEl) analysisEl.textContent = ''
  if (analysisTranslationSection) analysisTranslationSection.hidden = true
  if (analysisTranslatedText) analysisTranslatedText.textContent = ''
  if (analysisTranslateSelect) analysisTranslateSelect.innerHTML = ''
  analysisResult = { accuracy: null, feedback: '' }
  currentAnalysisTranslationLang = ''

  if (card.thumb) {
    cardImage.src = card.thumb
    cardImage.hidden = false
  } else if (card.imageSrc) {
    cardImage.src = card.imageSrc
    cardImage.hidden = false
  } else {
    cardImage.hidden = true
  }

  populateVoices(lang === 'en' ? 'en' : lang)
  setStatus('')
}

async function init () {
  const cardId = getCardIdFromHash()
  if (!cardId) {
    setStatus('No card selected.')
    return
  }

  const cards = await getCards()
  card = cards.find(item => item.id === cardId) || null
  updatePracticeCard()
}

function stopRecognition () {
  if (recognition && isRecording) {
    try {
      recognition.stop()
    } catch (error) {
      console.warn('Failed to stop recognition', error)
    }
  }
  isRecording = false
}

async function analyzeRecitation (reference, attempt, lang) {
  const trimmedAttempt = (attempt || '').trim()
  if (!trimmedAttempt) {
    if (analysisEl) analysisEl.textContent = 'No speech detected.'
    if (analysisTranslationSection) analysisTranslationSection.hidden = true
    if (analysisTranslatedText) analysisTranslatedText.textContent = ''
    analysisResult = { accuracy: null, feedback: '' }
    return
  }

  const trimmedReference = (reference || '').trim()
  let score = null
  let feedback = ''

  const heuristic = () => {
    const refTokens = trimmedReference.toLowerCase().split(/\s+/).filter(Boolean)
    const attemptTokens = trimmedAttempt.toLowerCase().split(/\s+/).filter(Boolean)
    const matches = attemptTokens.filter(token => refTokens.includes(token)).length
    const ratio = refTokens.length
      ? Math.round((matches / refTokens.length) * 100)
      : 0
    return {
      score: ratio,
      feedback: `Approximate match: ${ratio}% shared words.`
    }
  }

  let availabilityNote = ''
  const hasLanguageModel =
    typeof self !== 'undefined' &&
    self.LanguageModel &&
    typeof self.LanguageModel.create === 'function'

  if (trimmedReference && hasLanguageModel) {
    try {
      setStatus('Analyzing recitation...')
      const session = await self.LanguageModel.create({
        temperature: 0.2,
        topK: 1,
        outputLanguage: 'en',
        systemPrompt:
          'You are an encouraging language tutor. Respond with JSON {"accuracy": number, "feedback": string} describing pronunciation accuracy and specific guidance in English.'
      })
      const response = await session.prompt([
        {
          role: 'user',
          content: [
            {
              type: 'text',
              value: `Evaluate how closely the learner recited the reference passage. Identify pronunciation issues or missing sections succinctly.
Return JSON with keys "accuracy" (0-100) and "feedback" in English.

Reference language (${lang || 'en'}):
"""${trimmedReference}"""

Learner attempt:
"""${trimmedAttempt}"""`
            }
          ]
        }
      ])
      session.destroy?.()

      const stringifyOutput = value => {
        if (!value) return ''
        if (typeof value === 'string') return value
        if (Array.isArray(value)) {
          return value
            .map(part =>
              typeof part === 'string'
                ? part
                : typeof part?.text === 'string'
                ? part.text
                : typeof part?.value === 'string'
                ? part.value
                : ''
            )
            .join('\n')
        }
        if (typeof value?.output !== 'undefined') {
          return stringifyOutput(value.output)
        }
        return `${value}`
      }

      const raw = stringifyOutput(response).trim()
      try {
        const parsed = JSON.parse(raw)
        if (typeof parsed.accuracy === 'number') {
          score = Math.round(parsed.accuracy)
        }
        if (typeof parsed.feedback === 'string') {
          feedback = parsed.feedback.trim()
        }
      } catch (jsonError) {
        console.warn('Failed to parse LanguageModel JSON output; using raw text.', jsonError)
        feedback = raw
      }
    } catch (error) {
      availabilityNote = 'LanguageModel analysis failed; using fallback estimate.'
      console.warn('LanguageModel analysis failed, using heuristic.', error)
    }
  } else if (trimmedReference && !hasLanguageModel) {
    availabilityNote = 'LanguageModel API unavailable; providing fallback estimate.'
  }

  if (!feedback) {
    const fallback = heuristic()
    score = fallback.score
    feedback = fallback.feedback
  }

  if (analysisEl) {
    const fragment = document.createDocumentFragment()
    if (score != null) {
      const accuracyEl = document.createElement('strong')
      accuracyEl.className = 'analysis-accuracy'
      accuracyEl.textContent = `Accuracy: ${score}%`
      fragment.appendChild(accuracyEl)
    }
    if (feedback) {
      if (fragment.childNodes.length) fragment.appendChild(document.createTextNode(' — '))
      const feedbackEl = document.createElement('span')
      feedbackEl.textContent = feedback
      fragment.appendChild(feedbackEl)
    }
    if (availabilityNote) {
      if (fragment.childNodes.length) fragment.appendChild(document.createTextNode(' — '))
      const noteEl = document.createElement('em')
      noteEl.textContent = availabilityNote
      fragment.appendChild(noteEl)
    }
    analysisEl.textContent = ''
    analysisEl.appendChild(fragment)
  }

  const finalStatus = availabilityNote || 'Analysis complete.'
  setStatus(finalStatus)
  analysisResult = { accuracy: score, feedback }

  if (feedback) {
    buildAnalysisTranslationOptions(lang)
  } else if (analysisTranslationSection) {
    analysisTranslationSection.hidden = true
  }
}

function startRecognition () {
  if (isRecording) return
  const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!RecognitionCtor) {
    setStatus('Speech recognition is not supported in this browser.')
    return
  }

  const referenceText = practiceText.dataset.currentText || practiceText.textContent || ''
  if (!referenceText.trim()) {
    setStatus('Nothing to recite yet.')
    return
  }

  cancelSpeech()
  if (recitationSection) recitationSection.hidden = true
  if (transcriptionEl) transcriptionEl.textContent = ''
  if (analysisEl) analysisEl.textContent = ''
  recordedTranscript = ''

  recognition = new RecognitionCtor()
  recognition.lang = mapRecognitionLocale(card?.targetLanguage || 'en')
  recognition.interimResults = false
  recognition.maxAlternatives = 1

  recognition.onresult = event => {
    const transcript = Array.from(event.results)
      .map(result => result[0].transcript)
      .join(' ')
    recordedTranscript = transcript.trim()
  }

  recognition.onerror = event => {
    console.error('Speech recognition error', event.error)
    setStatus(`Speech recognition failed: ${event.error}`)
    isRecording = false
    if (recordButton) {
      recordButton.textContent = '🎙️'
      recordButton.title = 'Start recording'
    }
    recognition = null
  }

  recognition.onend = async () => {
    const attempt = recordedTranscript
    recognition = null
    if (recordButton) {
      recordButton.textContent = '🎙️'
      recordButton.title = 'Start recording'
    }
    isRecording = false

    if (attempt) {
      if (recitationSection) recitationSection.hidden = false
      if (transcriptionEl) transcriptionEl.textContent = `You said: "${attempt}"`
      await analyzeRecitation(referenceText, attempt, card?.targetLanguage || 'en')
    } else {
      if (recitationSection) recitationSection.hidden = true
      setStatus('No speech detected.')
    }
  }

  try {
    recognition.start()
    isRecording = true
    if (recordButton) {
      recordButton.textContent = '⏹️'
      recordButton.title = 'Stop recording'
    }
    setStatus('Listening... speak now.')
  } catch (error) {
    console.error('Failed to start speech recognition', error)
    setStatus('Unable to start recording.')
    recognition = null
    isRecording = false
    if (recordButton) {
      recordButton.textContent = '🎙️'
      recordButton.title = 'Start recording'
    }
  }
}

voiceSelect?.addEventListener('change', () => {
  const selected = voiceSelect.value
  currentVoice =
    voices.find(voice => voice.voiceURI === selected) || currentVoice || null
  setStatus(currentVoice ? `Voice: ${currentVoice.name}` : 'Voice updated.')
  if (window.speechSynthesis.speaking) {
    speakText(getDisplayedText(), card?.targetLanguage || 'en')
  }
})

playButton?.addEventListener('click', () => {
  if (!card) return
  if (window.speechSynthesis.paused) {
    resumeSpeech()
    return
  }
  speakText(getDisplayedText(), card?.targetLanguage || 'en')
})

pauseButton?.addEventListener('click', () => {
  pauseSpeech()
})

stopButton?.addEventListener('click', () => {
  cancelSpeech()
  setStatus('Stopped')
})

hideTextButton?.addEventListener('click', () => {
  hiddenText = !hiddenText
  if (hiddenText) {
    const fullText = practiceText.dataset.currentText || practiceText.textContent
    practiceText.setAttribute('data-full-text', fullText)
    practiceText.textContent = '••••••'
    hideTextButton.textContent = '👁️'
    hideTextButton.title = 'Show original text'
  } else {
    const full =
      practiceText.dataset.currentText ||
      practiceText.getAttribute('data-full-text') ||
      practiceText.textContent
    practiceText.textContent = full
    practiceText.removeAttribute('data-full-text')
    hideTextButton.textContent = '🙈'
    hideTextButton.title = 'Hide text'
  }
})

recordButton?.addEventListener('click', () => {
  if (isRecording) {
    stopRecognition()
    if (recordButton) {
      recordButton.textContent = '🎙️'
      recordButton.title = 'Start recording'
    }
    setStatus('Recording stopped.')
  } else {
    startRecognition()
  }
})

function buildAnalysisTranslationOptions () {
  if (!analysisTranslateSelect) return
  analysisTranslateSelect.innerHTML = ''
  const defaultOption = document.createElement('option')
  defaultOption.value = ''
  defaultOption.textContent = 'Select language'
  analysisTranslateSelect.appendChild(defaultOption)

  for (const { value, label } of LANGUAGES) {
    if (value === 'en') continue
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    analysisTranslateSelect.appendChild(option)
  }

  if (analysisTranslationSection) analysisTranslationSection.hidden = false
  currentAnalysisTranslationLang = ''
}

analysisTranslateSelect?.addEventListener('change', async () => {
  const target = analysisTranslateSelect.value
  if (!target) {
    if (analysisTranslatedText) analysisTranslatedText.textContent = ''
    currentAnalysisTranslationLang = ''
    return
  }

  if (!analysisResult.feedback) {
    if (analysisTranslatedText) analysisTranslatedText.textContent = 'No feedback available to translate.'
    return
  }

  if (currentAnalysisTranslationLang === target) return

  if (analysisTranslatedText) {
    analysisTranslatedText.textContent = `Translating to ${getLanguageLabel(target)}...`
  }
  try {
    const translated = await translateText({
      text: analysisResult.feedback,
      targetLanguage: target
    })
    if (analysisTranslatedText) analysisTranslatedText.textContent = translated
    currentAnalysisTranslationLang = target
  } catch (error) {
    console.error('Failed to translate feedback', error)
    if (analysisTranslatedText) analysisTranslatedText.textContent = 'Translation unavailable.'
  }
})

backButton?.addEventListener('click', async () => {
  const url = chrome.runtime.getURL('pages/history.html')
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { url })
      return
    }
  } catch (error) {
    console.warn('Failed to navigate via tabs API', error)
  }
  window.location.href = url
})

window.addEventListener('hashchange', init)
window.addEventListener('beforeunload', () => {
  cancelSpeech()
  stopRecognition()
})
window.addEventListener('unload', () => {
  cancelSpeech()
  stopRecognition()
})

if (typeof window.speechSynthesis !== 'undefined') {
  window.speechSynthesis.onvoiceschanged = () => {
    populateVoices(card?.targetLanguage || 'en')
  }
}

init().catch(error => {
  console.error('Failed to load practice card', error)
  setStatus('Failed to load card.')
})
