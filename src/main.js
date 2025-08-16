import { createClient } from '@supabase/supabase-js'

// 🔑 Supabase-Verbindung
const SUPABASE_URL = 'https://kbzzuwcbcshdbtsimrlw.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtienp1d2NiY3NoZGJ0c2ltcmx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5OTIyODMsImV4cCI6MjA3MDU2ODI4M30.0eutIAYGrfUc9ZMUO618FAEys_2YGWz4tBHpVV7sIa4'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// === Globale Variablen ===
let allLevels = []
let allWords = []
let currentIndex = 0
let currentUser = null

// === HTML-Elemente ===
const authContainer = document.getElementById('auth-container')
const appContainer = document.getElementById('app-container')
const gameContainer = document.getElementById('game-container')
const loginBtn = document.getElementById('login-btn')
const signupBtn = document.getElementById('signup-btn')
const logoutBtn = document.getElementById('logout-btn')
const correctBtn = document.getElementById('correct-btn')
const wrongBtn = document.getElementById('wrong-btn')
const questionEl = document.getElementById('question')
const answerEl = document.getElementById('answer')

// === Auth Funktionen ===
loginBtn?.addEventListener('click', async () => {
  const email = document.getElementById('email').value
  const password = document.getElementById('password').value
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) alert('Login fehlgeschlagen: ' + error.message)
})

signupBtn?.addEventListener('click', async () => {
  const email = document.getElementById('email').value
  const password = document.getElementById('password').value
  const { error } = await supabase.auth.signUp({ email, password })
  if (error) alert('Registrierung fehlgeschlagen: ' + error.message)
  else alert('Registrierung erfolgreich! Bitte prüfe deine E-Mail.')
})

logoutBtn?.addEventListener('click', async () => {
  await supabase.auth.signOut()
})

// === Auth-Status überwachen ===
supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null
  if (session) {
    authContainer.style.display = 'none'
    appContainer.style.display = 'block'
    loadCourse()
  } else {
    authContainer.style.display = 'block'
    appContainer.style.display = 'none'
    gameContainer.style.display = 'none'
  }
})

// === Kurs-Ladefunktion ===
async function loadCourse() {
  const app = document.getElementById('app')
  app.innerHTML = 'Lade Levels…'

  const { data: levels, error: levelsError } = await supabase
    .from('levels')
    .select('*')
    .order('sort', { ascending: true })

  if (levelsError) {
    app.innerHTML = 'Fehler beim Laden der Levels: ' + levelsError.message
    return
  }
  allLevels = levels

  app.innerHTML = ''
  for (const lvl of allLevels) {
    const block = document.createElement('div')
    block.innerHTML = `<h2>${lvl.name}</h2>`

    const startBtn = document.createElement('button')
    startBtn.textContent = 'Level lernen'
    startBtn.addEventListener('click', () => startLevel(lvl.id))
    block.appendChild(startBtn)

    app.appendChild(block)
  }
}

// === Lernmodus starten ===
async function startLevel(levelId) {
  // 1. Lade alle Wörter in diesem Level
  const { data: words, error: wordsError } = await supabase
    .from('words')
    .select('*')
    .eq('level_id', level_id)

  console.log('Loaded words:', words, 'Error:', wordsError) // <-- Add this

  if (wordsError) {
    alert('Fehler beim Laden der Wörter: ' + wordsError.message)
    return
  }

  // 2. Lade den Fortschritt des aktuellen Benutzers
  const { data: progressData, error: progressError } = await supabase
    .from('progress')
    .select('word_id, status')
    .eq('user_id', currentUser.id)

  if (progressError) {
    alert('Fehler beim Laden des Fortschritts: ' + progressError.message)
    return
  }

  // 3. Filter: Nur Wörter, die es im Fortschritt gar nicht gibt oder zuletzt "wrong" waren
  const filteredWords = words.filter(w => {
    const p = progressData.find(pr => pr.word_id === w.id)
    return !p || p.status === 'wrong'
  })

  if (!filteredWords.length) {
    alert('🎉 Alle Wörter in diesem Level sind gelernt!')
    return
  }

  // 4. Shuffle & Start
  currentIndex = 0
  filteredWords.sort(() => Math.random() - 0.5)
  gameContainer.style.display = 'block'
  appContainer.style.display = 'none'
  showWord(filteredWords)
}

// === Wort anzeigen ===
function showWord(words) {
  const word = words[currentIndex]
  if (!word) {
    alert('Level abgeschlossen!')
    gameContainer.style.display = 'none'
    appContainer.style.display = 'block'
    return
  }
  questionEl.textContent = word.term
  answerEl.textContent = word.translation
  answerEl.style.display = 'none'

  correctBtn.onclick = () => handleAnswer(true, word, words)
  wrongBtn.onclick = () => handleAnswer(false, word, words)
}

// === Antwort-Handling ===
async function handleAnswer(isCorrect, word, words) {
  // Antwort speichern
  await supabase
  .from('progress')
  .upsert(
    {
      user_id: currentUser.id,
      word_id: word.id, // UUID
      status: isCorrect ? 'correct' : 'wrong',
      last_review: new Date().toISOString()
    },
    { onConflict: 'user_id,word_id' }
  )


  // Nächstes Wort
  currentIndex++
  showWord(words)
}
