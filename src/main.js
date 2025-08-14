import { createClient } from '@supabase/supabase-js'

// ⬇️ Aus .env gelesen (bei Vite heißt das import.meta.env)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// kleine Sicherheitsprüfung für Einsteiger
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  document.getElementById('app').innerHTML = `
    <p style="color:red">
      Fehler: Supabase-URL oder anon key fehlt.<br>
      Hast du die Datei <code>.env</code> mit <code>VITE_SUPABASE_URL</code> und <code>VITE_SUPABASE_ANON_KEY</code> angelegt?
    </p>`
  throw new Error('Supabase env not set')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function load() {
  const app = document.getElementById('app')
  app.innerHTML = 'Lade Levels…'

  // Levels laden (sort optional)
  const { data: levels, error: lvlErr } = await supabase
    .from('levels')
    .select('*')
    .order('sort', { ascending: true })

  if (lvlErr) {
    app.innerHTML = `<p style="color:red">Fehler beim Laden der Levels: ${lvlErr.message}</p>`
    return
  }

  app.innerHTML = ''
  for (const lvl of levels || []) {
    const section = document.createElement('section')
    section.innerHTML = `<h2>${lvl.name}</h2>`

    const { data: words, error: wErr } = await supabase
      .from('words')
      .select('*')
      .eq('level_id', lvl.id)

    if (wErr) {
      section.innerHTML += `<p style="color:red">Fehler beim Laden der Wörter: ${wErr.message}</p>`
      app.appendChild(section)
      continue
    }

    const list = document.createElement('ul')
    for (const w of words || []) {
      const li = document.createElement('li')
      li.innerHTML = `
        <strong>${w.term}</strong> – ${w.translation}
        ${w.audio_url ? `&nbsp;<audio controls src="${w.audio_url}"></audio>` : ''}
        ${w.image_url ? `&nbsp;<img src="${w.image_url}" alt="">` : ''}
      `
      list.appendChild(li)
    }

    section.appendChild(list)
    app.appendChild(section)
  }
}

load()
