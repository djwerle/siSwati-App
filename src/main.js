import { createClient } from '@supabase/supabase-js'

// ===========================
// Supabase Setup
// ===========================
const supabaseUrl = "https://kbzzuwcbcshdbtsimrlw.supabase.co"
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtienp1d2NiY3NoZGJ0c2ltcmx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5OTIyODMsImV4cCI6MjA3MDU2ODI4M30.0eutIAYGrfUc9ZMUO618FAEys_2YGWz4tBHpVV7sIa4"
const supabase = createClient(supabaseUrl, supabaseKey)

// ===========================
// Global State
// ===========================
let currentUser = null
let currentLevelId = null
let currentLearningMode = null // 'new', 'review', 'difficult'
let sessionWords = []
let sessionIndex = 0
let sessionStats = { correct: 0, wrong: 0 }
let levels = []
const SRS_INTERVALS = [1, 3, 7, 14, 30, 90, 180, 365] // Tage
const DIFFICULT_THRESHOLD = 3
const ADMIN_EMAIL = 'davidwerle@gmx.de'

// ===========================
// UI Elements
// ===========================
const authContainer = document.getElementById('auth-screen')
const appContainer = document.getElementById('main-app')
const levelSelection = document.getElementById('level-selection')
const learningScreen = document.getElementById('learning-screen')
const loginForm = document.getElementById('login-form')
const registerForm = document.getElementById('register-form')
const logoutBtn = document.getElementById('logout-btn')

// ===========================
// Auth Functions
// ===========================
async function checkAuth() {
  const { data } = await supabase.auth.getUser()
  if (data.user) {
    currentUser = data.user
    showMainApp()
  } else {
    showAuthScreen()
  }
}

function showAuthScreen() {
  authContainer.classList.remove('hidden')
  appContainer.classList.add('hidden')
}

function showMainApp() {
  authContainer.classList.add('hidden')
  appContainer.classList.remove('hidden')
  document.getElementById('user-email').textContent = currentUser.email
  if (isAdmin()) {
    document.getElementById('admin-badge').classList.remove('hidden')
  } else {
    document.getElementById('admin-badge').classList.add('hidden')
  }
  loadLevels()
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const email = document.getElementById('login-email').value.trim().toLowerCase()
  const password = document.getElementById('login-password').value
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    showAuthError('login', error.message)
  } else {
    currentUser = data.user
    showMainApp()
  }
})

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const email = document.getElementById('register-email').value.trim().toLowerCase()
  const password = document.getElementById('register-password').value
  const confirmPassword = document.getElementById('register-confirm').value
  if (password !== confirmPassword) {
    showAuthError('register', 'Passwords do not match.')
    return
  }
  if (password.length < 6) {
    showAuthError('register', 'Password must be at least 6 characters.')
    return
  }
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) {
    showAuthError('register', error.message)
  } else {
    alert("Registration successful! Please log in.")
    showLoginForm()
  }
})

logoutBtn.onclick = async () => {
  await supabase.auth.signOut()
  currentUser = null
  showAuthScreen()
}

function showAuthError(formType, message) {
  const errorElement = document.getElementById(`${formType}-error`)
  errorElement.textContent = message
  errorElement.classList.remove('hidden')
}

function showLoginForm() {
  loginForm.classList.remove('hidden')
  registerForm.classList.add('hidden')
  clearAuthErrors()
}

function showRegisterForm() {
  loginForm.classList.add('hidden')
  registerForm.classList.remove('hidden')
  clearAuthErrors()
}

function clearAuthErrors() {
  document.getElementById('login-error').classList.add('hidden')
  document.getElementById('register-error').classList.add('hidden')
}

function isAdmin() {
  return currentUser && currentUser.email === ADMIN_EMAIL
}

function requireAdmin() {
  if (!isAdmin()) {
    alert('This feature is only available to administrators.')
    return false
  }
  return true
}

// ===========================
// Levels & Words from Supabase
// ===========================
async function loadLevels() {
  const { data, error } = await supabase.from('levels').select('id, name')
  if (error) {
    alert("Error loading levels")
    return
  }
  levels = data
  renderLevels()
  updateModeCounts()
  updateOverallProgress()
}

async function getWordsInLevel(levelId) {
  const { data, error } = await supabase.from('words').select('*').eq('level_id', levelId)
  return data || []
}

async function getAllWords() {
  const { data, error } = await supabase.from('words').select('*')
  return data || []
}

// ===========================
// Progress Functions (Supabase)
// ===========================
async function getWordProgress(wordId) {
  const { data } = await supabase
    .from('progress')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('word_id', wordId)
    .maybeSingle()
  return data || {
    user_id: currentUser.id,
    word_id: wordId,
    correct_count: 0,
    wrong_count: 0,
    current_step: 0,
    level: 0,
    is_learned: false
  }
}

async function updateWordProgress(word, isCorrect) {
  let progress = await getWordProgress(word.id)
  progress.last_review = new Date().toISOString()
  if (isCorrect) {
    progress.correct_count++
    if (progress.current_step >= 4) {
      progress.level = Math.min(progress.level + 1, SRS_INTERVALS.length - 1)
      const daysToAdd = SRS_INTERVALS[progress.level]
      progress.next_review = new Date(Date.now() + daysToAdd * 86400000).toISOString()
      progress.is_learned = true
    } else {
      progress.current_step++
    }
  } else {
    progress.wrong_count++
    if (progress.is_learned) {
      progress.level = Math.max(0, progress.level - 1)
      const daysToAdd = SRS_INTERVALS[progress.level]
      progress.next_review = new Date(Date.now() + daysToAdd * 86400000).toISOString()
    }
  }
  await supabase.from('progress').upsert(progress)
}

async function getWordsForReview() {
  const { data: progress } = await supabase
    .from('progress')
    .select('word_id, next_review')
    .eq('user_id', currentUser.id)
  const dueIds = (progress || [])
    .filter(p => p.next_review && new Date(p.next_review) <= new Date())
    .map(p => p.word_id)
  if (dueIds.length === 0) return []
  const { data: words } = await supabase.from('words').select('*').in('id', dueIds)
  return words || []
}

async function getDifficultWords() {
  const { data: progress } = await supabase
    .from('progress')
    .select('word_id, wrong_count')
    .eq('user_id', currentUser.id)
  const difficultIds = (progress || [])
    .filter(p => p.wrong_count >= DIFFICULT_THRESHOLD)
    .map(p => p.word_id)
  if (difficultIds.length === 0) return []
  const { data: words } = await supabase.from('words').select('*').in('id', difficultIds)
  return words || []
}

async function getNewWordsInLevel(levelId) {
  const words = await getWordsInLevel(levelId)
  const newWords = []
  for (const word of words) {
    const progress = await getWordProgress(word.id)
    if (!progress.is_learned && progress.current_step === 0) {
      newWords.push(word)
    }
  }
  return newWords
}

// ===========================
// UI Rendering
// ===========================
async function renderLevels() {
  const levelGrid = document.getElementById('level-grid')
  levelGrid.innerHTML = ''

  for (const level of levels) {
    // Hole die neuen Wörter und den Fortschritt anhand der level.id (nicht level_name/UUID-String)
    const newWords = await getNewWordsInLevel(level.id)
    const levelProgress = await getLevelProgress(level.id)
    const isCompleted = levelProgress.completed === levelProgress.total

    const levelItem = document.createElement('div')
    levelItem.className = `level-item`

    if (newWords.length > 0) {
      levelItem.onclick = () => startNewWordsMode(level.id)
    }

    levelItem.innerHTML = `
      <div class="level-icon ${isCompleted ? 'completed' : ''}">
        <span class="level-number"></span> <!-- hier absichtlich leer -->
      </div>
      <div class="level-name">${level.name || ''}</div>
      <div class="level-progress">${levelProgress.completed}/${levelProgress.total}</div>
      ${newWords.length > 0
        ? `<div class="level-new-words">${newWords.length} new words</div>`
        : '<div class="level-new-words">All learned</div>'}
    `
    levelGrid.appendChild(levelItem)
  }
}


async function getLevelProgress(levelId) {
  const words = await getWordsInLevel(levelId)
  let completed = 0
  for (const word of words) {
    const progress = await getWordProgress(word.id)
    if (progress.is_learned) completed++
  }
  return { completed, total: words.length }
}

async function updateModeCounts() {
  const reviewWords = await getWordsForReview()
  const reviewCount = document.getElementById('review-count')
  const reviewMode = document.getElementById('review-mode')
  if (reviewWords.length > 0) {
    reviewCount.textContent = `${reviewWords.length} words`
    reviewCount.classList.remove('zero')
    reviewMode.classList.remove('disabled')
  } else {
    reviewCount.textContent = 'No words due'
    reviewCount.classList.add('zero')
    reviewMode.classList.add('disabled')
  }
  const difficultWords = await getDifficultWords()
  const difficultCount = document.getElementById('difficult-count')
  const difficultMode = document.getElementById('difficult-mode')
  if (difficultWords.length > 0) {
    difficultCount.textContent = `${difficultWords.length} words`
    difficultCount.classList.remove('zero')
    difficultMode.classList.remove('disabled')
  } else {
    difficultCount.textContent = 'No difficult words'
    difficultCount.classList.add('zero')
    difficultMode.classList.add('disabled')
  }
}

async function updateOverallProgress() {
  let totalWords = 0
  let learnedCount = 0
  for (const level of levels) {
    const words = await getWordsInLevel(level.id)
    totalWords += words.length
    for (const word of words) {
      const progress = await getWordProgress(word.id)
      if (progress.is_learned) learnedCount++
    }
  }
  document.getElementById('words-learned-count').textContent = learnedCount
  document.getElementById('total-words-count').textContent = totalWords
  const percentage = totalWords > 0 ? (learnedCount / totalWords) * 100 : 0
  document.getElementById('progress').style.width = percentage + '%'
}

// ===========================
// Learning Modes
// ===========================
async function startNewWordsMode(levelId) {
  currentLearningMode = 'new'
  currentLevelId = levelId
  const newWords = await getNewWordsInLevel(levelId)
  if (newWords.length === 0) {
    alert('No new words to learn in this level!')
    return
  }
  sessionWords = newWords.slice(0, Math.min(10, newWords.length))
  sessionIndex = 0
  sessionStats = { correct: 0, wrong: 0 }
  levelSelection.classList.add('hidden')
  learningScreen.classList.remove('hidden')
  document.getElementById('current-mode-name').textContent = `Level ${levelId} - New Words`
  updateSessionProgress()
  showStep()
}

async function startReviewMode() {
  const reviewWords = await getWordsForReview()
  if (reviewWords.length === 0) {
    alert('No words due for review!')
    return
  }
  currentLearningMode = 'review'
  currentLevelId = null
  sessionWords = reviewWords.slice(0, Math.min(20, reviewWords.length))
  sessionIndex = 0
  sessionStats = { correct: 0, wrong: 0 }
  levelSelection.classList.add('hidden')
  learningScreen.classList.remove('hidden')
  document.getElementById('current-mode-name').textContent = 'Review Session'
  updateSessionProgress()
  showStep()
}

async function startDifficultMode() {
  const difficultWords = await getDifficultWords()
  if (difficultWords.length === 0) {
    alert('No difficult words to practice!')
    return
  }
  currentLearningMode = 'difficult'
  currentLevelId = null
  sessionWords = difficultWords.slice(0, Math.min(15, difficultWords.length))
  sessionIndex = 0
  sessionStats = { correct: 0, wrong: 0 }
  levelSelection.classList.add('hidden')
  learningScreen.classList.remove('hidden')
  document.getElementById('current-mode-name').textContent = 'Difficult Words'
  updateSessionProgress()
  showStep()
}

function updateSessionProgress() {
  document.getElementById('current-word-number').textContent = sessionIndex + 1
  document.getElementById('total-session-words').textContent = sessionWords.length
}

function getCurrentWord() {
  if (sessionIndex >= sessionWords.length) return null
  return sessionWords[sessionIndex]
}

function nextSessionWord() {
  sessionIndex++
  updateSessionProgress()
  if (sessionIndex >= sessionWords.length) {
    showSessionComplete()
  } else {
    showStep()
  }
}

function showSessionComplete() {
  const stepContent = document.getElementById('step-content')
  const accuracy = sessionStats.correct + sessionStats.wrong > 0
    ? Math.round((sessionStats.correct / (sessionStats.correct + sessionStats.wrong)) * 100)
    : 0
  stepContent.innerHTML = `
    <div class="session-complete">
      <div class="session-complete-icon">🎉</div>
      <h2>Session Complete!</h2>
      <p>Great job! You've completed your ${currentLearningMode} session.</p>
      <div class="session-stats">
        <div class="stat-item"><span class="stat-number">${sessionStats.correct}</span><div class="stat-label">Correct</div></div>
        <div class="stat-item"><span class="stat-number">${sessionStats.wrong}</span><div class="stat-label">Wrong</div></div>
        <div class="stat-item"><span class="stat-number">${accuracy}%</span><div class="stat-label">Accuracy</div></div>
        <div class="stat-item"><span class="stat-number">${sessionWords.length}</span><div class="stat-label">Words Practiced</div></div>
      </div>
      <button class="continue-btn" onclick="backToLevels()">Continue Learning</button>
    </div>
  `
}

function backToLevels() {
  showLevelSelection()
}

function showLevelSelection() {
  levelSelection.classList.remove('hidden')
  learningScreen.classList.add('hidden')
  renderLevels()
  updateModeCounts()
  updateOverallProgress()
}

// ===========================
// Learning Steps UI (5 steps)
// ===========================
async function showStep() {
  const stepContent = document.getElementById('step-content')
  const word = getCurrentWord()
  if (!word) {
    showSessionComplete()
    return
  }

  const progress = await getWordProgress(word.id)
  let currentStep = progress.current_step

  // Für Review/Difficult Mode: zufälliger Schritt
  if (currentLearningMode === 'review' || currentLearningMode === 'difficult') {
    currentStep = Math.floor(Math.random() * 5) // 0–4
  }

  // ===== STEP 0: Einführung (Englisch + siSwati + Auto-Audio) =====
  if (currentStep === 0) {
    stepContent.innerHTML = `
      <div class="word-introduction">
        <div class="language-label">ENGLISH</div>
        <div class="main-word">${word.term}</div>

        <div class="translation-section">
          <div class="language-label">SISWATI</div>
          <div class="translation">${word.translation}</div>
        </div>

        <div class="audio-section">
          <button class="audio-button" onclick="playAudio('${word.audio_url}')">🔊</button>
        </div>

        <button class="next-button" onclick="nextStep()">Next ▶</button>
      </div>
    `
    // Audio automatisch abspielen
    if (word.audio_url) {
      setTimeout(() => playAudio(word.audio_url), 800)
    }
    return
  }

  // ===== STEP 1: Multiple Choice (Text) =====
  if (currentStep === 1) {
    const options = await getMultipleChoiceOptions(word.translation)
    stepContent.innerHTML = `
      <div class="multiple-choice-section">
        <div class="question-header">Pick the correct answer</div>
        <div class="question-text">${word.term}</div>
        <div class="choices-grid">
          ${options.map((option, index) => `
            <button class="choice-button" 
              onclick="checkChoice('${option}', '${word.translation}', 1)">
              <span class="choice-number">${index + 1}</span>
              <span class="choice-text">${option}</span>
            </button>
          `).join('')}
        </div>
        <div id="feedback" class="feedback hidden"></div>
      </div>
    `
    return
  }

  // Step 2: Audio Multiple Choice
if (currentStep === 2) {
  const hasAudio = word.audio_url && word.audio_url.trim() !== ""

  if (!hasAudio) {
    // Falls kein Audio vorhanden -> direkt weiterspringen
    nextStep()
    return
  }

  // Erzeuge Antwortoptionen (korrekt + 3 falsche)
  const options = await getMultipleChoiceOptions(word.term)

  stepContent.innerHTML = `
    <div class="audio-choice-section">
      <div class="question-header">Choose the translation for what you hear</div>
      
      <div class="audio-player-section">
        <button class="large-audio-button" onclick="playAudio('${word.audio_url}')">🔊 Play</button>
      </div>

      <div class="choices-grid">
        ${options.map((option, index) => 
          `<button class="choice-button" onclick="checkAudioChoice('${option}', '${word.term}', 2)">
            <span class="choice-number">${index + 1}</span>
            <span class="choice-text">${option}</span>
          </button>`
        ).join('')}
      </div>

      <div id="feedback" class="feedback hidden"></div>
    </div>
  `

  // Audio automatisch abspielen nach 500ms
  setTimeout(() => {
    playAudio(word.audio_url)
  }, 500)
  return
}


  // ===== STEP 3: Input (kurze Eingabe) =====
  if (currentStep === 3) {
    stepContent.innerHTML = `
      <div class="input-section">
        <div class="question-text">Type the siSwati word for "${word.term}":</div>
        <input type="text" class="text-input" id="user-input" placeholder="Type here..." onkeypress="handleEnter(event)">
        <button class="submit-button" onclick="checkInput(3)">Check</button>
        <div id="feedback" class="feedback hidden"></div>
      </div>
    `
    setTimeout(() => document.getElementById('user-input').focus(), 100)
    return
  }

  // ===== STEP 4: Typing mit Letter-Hints =====
  if (currentStep === 4) {
    stepContent.innerHTML = `
      <div class="typing-section">
        <div class="typing-header">Type the correct translation</div>
        <div class="english-word">${word.term}</div>
        <div class="language-indicator">SISWATI</div>

        <div class="typing-input-container">
          <input type="text" class="typing-input" id="typing-input" placeholder="" 
            onkeypress="handleTypingEnter(event)">
        </div>

        <div class="letter-hints">${generateLetterHints(word.translation)}</div>

        <div id="typing-feedback" class="typing-feedback hidden"></div>
        <div id="wrong-answer-display" class="wrong-answer-display hidden"></div>

        <div id="next-button-container" class="next-button-container hidden">
          <button class="next-button-small" onclick="nextStep()">Next ▶</button>
        </div>
      </div>
    `
    setTimeout(() => document.getElementById('typing-input').focus(), 100)
    return
  }
}

// ================== FEEDBACK SYSTEM ==================

function showCorrectFeedback() {
  const container = document.getElementById('feedback-container')
  const message = document.getElementById('feedback-message')

  container.classList.remove('hidden')
  message.className = 'correct-feedback'
  message.textContent = '✅ Correct!'

  // Automatisch weiter nach 1.5 Sekunden
  setTimeout(() => {
    container.classList.add('hidden')
    nextStep()
  }, 1500)
}

function showWrongFeedback(userAnswer, correctAnswer, englishTerm) {
  const container = document.getElementById('feedback-container')
  const message = document.getElementById('feedback-message')

  container.classList.remove('hidden')
  message.className = 'wrong-feedback'
  message.innerHTML = `
    <div class="your-answer">YOUR ANSWER: <b>${userAnswer}</b></div>
    <div class="correct-answer">
      <div class="lang-label">SISWATI</div>
      <div class="answer">${correctAnswer}</div>
    </div>
    <div class="english-hint">(${englishTerm})</div>
    <button class="next-button" onclick="hideFeedbackAndNext()">Next ▶</button>
  `
}

function hideFeedbackAndNext() {
  const container = document.getElementById('feedback-container')
  container.classList.add('hidden')
  nextStep()
}

// ===========================
// Utility Functions
// ===========================
function shuffle(array) {
  const newArray = [...array]
  for (let i = newArray.length - 1; i > 0; i--) {
    var swapIndex = Math.floor(Math.random() * (i + 1))
    if (typeof newArray[i] === 'undefined' || typeof newArray[swapIndex] === 'undefined') continue
    [newArray[i], newArray[swapIndex]] = [newArray[swapIndex], newArray[i]]
  }
  return newArray
}

async function getMultipleChoiceOptions(correct) {
  const allWords = await getAllWords()
  const wrongAnswers = []
  while (wrongAnswers.length < 3) {
    const randomWord = allWords[Math.floor(Math.random() * allWords.length)]
    if (
      randomWord &&
      randomWord.translation &&
      randomWord.translation !== correct &&
      !wrongAnswers.includes(randomWord.translation)
    ) {
      wrongAnswers.push(randomWord.translation)
    }
    if (wrongAnswers.length > 10) break // Prevent infinite loop
  }
  // Filter out undefined values before shuffling
  const options = [correct, ...wrongAnswers].filter(Boolean)
  return shuffle(options)
}

// ===========================
// Step Handlers
// ===========================
async function nextStep() {
  const word = getCurrentWord()
  const progress = await getWordProgress(word.id)
  if (progress.current_step < 4) {
    progress.current_step++
    await supabase.from('progress').upsert(progress)
    showStep()
  } else {
    nextSessionWord()
  }
}
window.nextStep = nextStep

// Multiple Choice
async function checkChoice(selected, correct, stepNumber) {
  const word = getCurrentWord()
  const isCorrect = selected === correct

  if (isCorrect) {
    sessionStats.correct++
    await updateWordProgress(word, true)
    showCorrectFeedback() // ✅ Grüner Button oben rechts
  } else {
    sessionStats.wrong++
    await updateWordProgress(word, false)
    showWrongFeedback(selected, correct, word.term) // ❌ Rotes Feld mit YOUR ANSWER etc.
  }
}
window.checkChoice = checkChoice

// Texteingabe
async function checkInput(stepNumber) {
  const word = getCurrentWord()
  const userInput = document.getElementById('user-input').value.trim().toLowerCase()
  const correct = word.translation.toLowerCase()
  const isCorrect = userInput === correct

  if (isCorrect) {
    sessionStats.correct++
    await updateWordProgress(word, true)
    showCorrectFeedback()
  } else {
    sessionStats.wrong++
    await updateWordProgress(word, false)
    showWrongFeedback(userInput, word.translation, word.term)
  }
}
window.checkInput = checkInput

// ===================== Audio Multiple Choice =====================
async function checkAudioChoice(selected, correct, stepNumber) {
  const word = getCurrentWord()
  const feedbackContainer = document.getElementById('feedback-container')
  const feedbackMessage = document.getElementById('feedback-message')

  const isCorrect = selected === correct

  if (isCorrect) {
    sessionStats.correct++
    await updateWordProgress(word, true)

    // ✅ Grüner Feedback-Button
    feedbackMessage.innerHTML = `<div class="feedback-correct">✅ Correct!</div>`
    feedbackContainer.classList.remove('hidden')

    // nach 1.5s automatisch weiter
    setTimeout(() => {
      feedbackContainer.classList.add('hidden')
      nextStep()
    }, 1500)
  } else {
    sessionStats.wrong++
    await updateWordProgress(word, false)

    // ❌ Rotes Feedback mit korrekter Antwort
    feedbackMessage.innerHTML = `
      <div class="feedback-wrong">
        <div class="your-answer">YOUR ANSWER:<br>${selected}</div>
        <div class="correct-answer">
          <div class="label">SISWATI</div>
          <div class="word">${correct}</div>
          <div class="label">ENGLISH</div>
          <div class="word">${word.term}</div>
        </div>
        <div class="next-button-container">
          <button class="next-button-small" onclick="nextStep()">Next ▶</button>
        </div>
      </div>
    `
    feedbackContainer.classList.remove('hidden')
  }
}
window.checkAudioChoice = checkAudioChoice

function playAudio(audioUrl) {
  if (!audioUrl) return
  const audio = new Audio(audioUrl)
  audio.play().catch(err => console.warn("Audio play failed:", err))
}
window.playAudio = playAudio


function handleEnter(event) {
  if (event.key === 'Enter') {
    checkInput(3)
  }
}
window.handleEnter = handleEnter

function handleTypingEnter(event) {
  if (event.key === 'Enter') {
    const word = getCurrentWord()
    const userInput = document.getElementById('typing-input').value.trim().toLowerCase()
    const correct = word.translation.toLowerCase()
    const isCorrect = userInput === correct
    if (isCorrect) sessionStats.correct++
    else sessionStats.wrong++
    updateWordProgress(word, isCorrect)
    setTimeout(() => nextStep(), 1000)
  }
}
window.handleTypingEnter = handleTypingEnter

window.backToLevels = backToLevels
window.handleLogout = async function () {
  await supabase.auth.signOut()
  currentUser = null
  showAuthScreen()
}

// ===========================
// Init
// ===========================
document.addEventListener('DOMContentLoaded', function () {
  checkAuth()
})