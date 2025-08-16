// === Supabase Client ===
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://kbzzuwcbcshdbtsimrlw.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtienp1d2NiY3NoZGJ0c2ltcmx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5OTIyODMsImV4cCI6MjA3MDU2ODI4M30.0eutIAYGrfUc9ZMUO618FAEys_2YGWz4tBHpVV7sIa4'
const supabase = createClient(supabaseUrl, supabaseKey)

// === DOM Elemente ===
const authContainer = document.getElementById('auth-container')
const appContainer = document.getElementById('app-container')
const gameContainer = document.getElementById('game-container')

const loginBtn = document.getElementById('login-btn')
const signupBtn = document.getElementById('signup-btn')
const logoutBtn = document.getElementById('logout-btn')

const questionEl = document.getElementById('question')
const answerEl = document.getElementById('answer')
const showAnswerBtn = document.getElementById('show-answer-btn')
const correctBtn = document.getElementById('correct-btn')
const wrongBtn = document.getElementById('wrong-btn')

// === Globale Variablen ===
let currentUser = null
let currentIndex = 0
let currentWords = []
let currentLevelId = null

// === Debug Helper ===
function log(...args) {
  console.log('[DEBUG]', ...args)
}

// === Auth ===
loginBtn.onclick = async () => {
  const email = document.getElementById('email').value
  const password = document.getElementById('password').value
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) alert(error.message)
  else handleLogin(data.user)
}

signupBtn.onclick = async () => {
  const email = document.getElementById('email').value
  const password = document.getElementById('password').value
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) alert(error.message)
  else alert('Registrierung erfolgreich. Bitte einloggen.')
}

logoutBtn.onclick = async () => {
  await supabase.auth.signOut()
  currentUser = null
  currentLevelId = null

  // Ansicht zurücksetzen
  showView('login')

  // Inhalte löschen
  questionEl.textContent = ''
  answerEl.textContent = ''
  answerEl.style.display = 'none'

  localStorage.removeItem('view')
  localStorage.removeItem('levelId')
}

function handleLogin(user) {
  currentUser = user
  showView('levels')
  loadLevels()
}

// === Views umschalten ===
function showView(view) {
  authContainer.style.display = 'none'
  appContainer.style.display = 'none'
  gameContainer.style.display = 'none'

  if (view === 'login') authContainer.style.display = 'block'
  if (view === 'levels') appContainer.style.display = 'block'
  if (view === 'game') gameContainer.style.display = 'block'

  localStorage.setItem('view', view)
}

// === Levels laden ===
async function loadLevels() {
  const { data: levels, error } = await supabase.from('levels').select('*')
  if (error) {
    console.error(error)
    return
  }

  const app = document.getElementById('app')
  app.innerHTML = ''
  levels.forEach(level => {
    const btn = document.createElement('button')
    btn.textContent = level.name
    btn.onclick = () => startLevel(level.id)
    app.appendChild(btn)
  })
}

// === Lernmodus starten ===
async function startLevel(levelId) {
  log('startLevel()', { levelId })
  currentLevelId = levelId
  localStorage.setItem('levelId', levelId)

  // Wörter laden
  const { data: words, error: wordsError } = await supabase
    .from('words')
    .select('*')
    .eq('level_id', levelId)

  if (wordsError) {
    console.error(wordsError)
    alert('Fehler beim Laden der Wörter: ' + wordsError.message)
    return
  }
  log('words loaded', { count: words?.length })

  // Fortschritt laden
  const { data: progressData, error: progressError } = await supabase
    .from('progress')
    .select('word_id, status')
    .eq('user_id', currentUser.id)

  if (progressError) {
    console.error(progressError)
    alert('Fehler beim Laden des Fortschritts: ' + progressError.message)
    return
  }
  log('progress loaded', { count: progressData?.length })

  // Wörter filtern
  const filteredWords = (words || []).filter(w => {
    const p = (progressData || []).find(pr => pr.word_id === w.id)
    return !p || p.status === 'wrong'
  })

  log('filteredWords', { count: filteredWords.length })

  if (!filteredWords.length) {
    showView('levels')
    const app = document.getElementById('app')
    app.innerHTML = `<p>🎉 Alle Wörter in diesem Level sind gelernt!</p>`
    return
  }

  // Shuffle
  currentIndex = 0
  currentWords = filteredWords.sort(() => Math.random() - 0.5)

  showView('game')
  showWord()
}

// === Wort anzeigen ===
function showWord() {
  log('showWord()', { currentIndex, total: currentWords.length })

  if (currentIndex >= currentWords.length) {
    alert('🎉 Level abgeschlossen!')
    showView('levels')
    return
  }

  const word = currentWords[currentIndex]
  if (!word) {
    log('showWord: word ist undefined bei Index', currentIndex)
    return
  }

  log('zeige Wort', word)

  questionEl.textContent = word.term ?? '(ohne term)'
  answerEl.textContent = word.translation ?? '(ohne translation)'

  // Reset Sichtbarkeit
  answerEl.style.display = 'none'
  correctBtn.style.display = 'none'
  wrongBtn.style.display = 'none'
  showAnswerBtn.style.display = 'inline-block'

  // 👉 Animation triggern
  const card = document.getElementById('question-card')
  if (card) {
    card.style.animation = 'none'
    void card.offsetWidth // reflow trick
    card.style.animation = 'slideIn 0.4s ease'
  }

  // Button-Events
  showAnswerBtn.onclick = () => {
    answerEl.style.display = 'block'
    correctBtn.style.display = 'inline-block'
    wrongBtn.style.display = 'inline-block'
    showAnswerBtn.style.display = 'none'
  }

  correctBtn.onclick = async () => {
    await handleAnswer(word, true)
    currentIndex++
    showWord()
  }

  wrongBtn.onclick = async () => {
    await handleAnswer(word, false)
    currentIndex++
    showWord()
  }
}

// === Antwort speichern ===
async function handleAnswer(word, isCorrect) {
  const payload = {
    user_id: currentUser.id,
    word_id: word.id,
    status: isCorrect ? 'correct' : 'wrong',
    last_review: new Date().toISOString()
  }

  const { error } = await supabase
    .from('progress')
    .upsert(payload, { onConflict: 'user_id,word_id' })

  if (error) {
    console.error('progress upsert error', error)
    alert('Konnte Fortschritt nicht speichern: ' + error.message)
  } else {
    log('progress saved', payload)
  }
}

// === Session prüfen & View wiederherstellen ===
supabase.auth.getSession().then(({ data }) => {
  if (data.session) {
    handleLogin(data.session.user)

    // Letzte Ansicht wiederherstellen
    const lastView = localStorage.getItem('view')
    const lastLevel = localStorage.getItem('levelId')

    if (lastView === 'game' && lastLevel) {
      startLevel(lastLevel)
    } else if (lastView === 'levels') {
      showView('levels')
    } else {
      showView('levels')
    }
  } else {
    showView('login')
  }
})

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) handleLogin(session.user)
  else showView('login')
})

console.log('main.js geladen, alles bereit ✅')
