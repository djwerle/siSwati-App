import { createClient } from '@supabase/supabase-js'

// 🔑 Supabase-Verbindung – hier deine echten Werte einsetzen:
const SUPABASE_URL = 'https://kbzzuwcbcshdbtsimrlw.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtienp1d2NiY3NoZGJ0c2ltcmx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5OTIyODMsImV4cCI6MjA3MDU2ODI4M30.0eutIAYGrfUc9ZMUO618FAEys_2YGWz4tBHpVV7sIa4'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// HTML-Elemente abrufen
const authContainer = document.getElementById('auth-container')
const appContainer = document.getElementById('app-container')
const loginBtn = document.getElementById('login-btn')
const signupBtn = document.getElementById('signup-btn')
const logoutBtn = document.getElementById('logout-btn')

// Login-Button
loginBtn?.addEventListener('click', async () => {
  const email = document.getElementById('email').value
  const password = document.getElementById('password').value
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    alert('Login fehlgeschlagen: ' + error.message)
  }
})

// Registrieren-Button
signupBtn?.addEventListener('click', async () => {
  const email = document.getElementById('email').value
  const password = document.getElementById('password').value
  const { error } = await supabase.auth.signUp({ email, password })
  if (error) {
    alert('Registrierung fehlgeschlagen: ' + error.message)
  } else {
    alert('Registrierung erfolgreich! Bitte prüfe deine E-Mail.')
  }
})

// Logout-Button
logoutBtn?.addEventListener('click', async () => {
  await supabase.auth.signOut()
})

// Auth-Status überwachen
supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    authContainer.style.display = 'none'
    appContainer.style.display = 'block'
    loadCourse()
  } else {
    authContainer.style.display = 'block'
    appContainer.style.display = 'none'
  }
})

// Kurs laden
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

  app.innerHTML = ''
  for (const lvl of levels || []) {
    const block = document.createElement('div')
    block.innerHTML = `<h2>${lvl.name}</h2>`

    const { data: words, error: wordsError } = await supabase
      .from('words')
      .select('*')
      .eq('level_id', lvl.id)

    if (wordsError) {
      block.innerHTML += `<p>Fehler beim Laden der Wörter: ${wordsError.message}</p>`
      app.appendChild(block)
      continue
    }

    const list = document.createElement('ul')
    for (const w of words || []) {
      const li = document.createElement('li')
      li.innerHTML = `
        <strong>${w.term}</strong> – ${w.translation}
        ${w.audio_url ? `<audio controls src="${w.audio_url}"></audio>` : ''}
        ${w.image_url ? `<img src="${w.image_url}" style="max-height:80px">` : ''}
      `
      list.appendChild(li)
    }
    block.appendChild(list)
    app.appendChild(block)
  }
}
