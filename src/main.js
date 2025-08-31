// Supabase Configuration
const SUPABASE_URL = 'https://kbzzuwcbcshdbtsimrlw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtienp1d2NiY3NoZGJ0c2ltcmx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5OTIyODMsImV4cCI6MjA3MDU2ODI4M30.0eutIAYGrfUc9ZMUO618FAEys_2YGWz4tBHpVV7sIa4';
const ADMIN_EMAIL = 'davidwerle@gmx.de';

// Initialize Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global Variables
let currentUser = null;
let currentLevelId = null;
let currentIndex = 0;
let currentLearningMode = null; // 'new', 'review', 'difficult'
let sessionWords = []; // Aktuelle Lernsession
let sessionIndex = 0;
let sessionStats = { correct: 0, wrong: 0 };

// SRS und Fortschritt
let levels = [];
let words = [];
let userProgress = new Map(); // SRS Daten für jedes Wort
let failedSteps = new Map(); // Speichert fehlgeschlagene Schritte für Wiederholung
let failedStepsQueue = []; // Warteschlange für fehlgeschlagene Schritte
let stepsSinceLastFailed = 0; // Zähler für Schritte seit letztem Fehler
const STEPS_BEFORE_RETRY = 2; // Anzahl Schritte bevor fehlgeschlagener Schritt wiederholt wird

// SRS Konstanten (Memrise-ähnlich)
const SRS_INTERVALS = [
  1,      // 1 Tag
  3,      // 3 Tage
  7,      // 1 Woche
  14,     // 2 Wochen
  30,     // 1 Monat
  90,     // 3 Monate
  180,    // 6 Monate
  365     // 1 Jahr
];

const DIFFICULT_THRESHOLD = 3; // Anzahl Fehler bevor Wort als schwierig gilt

// Authentication System
async function initializeAuth() {
  try {
    // Check if user is already logged in
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session) {
      currentUser = session.user;
      await loadUserData();
      showMainApp();
    } else {
      showAuthScreen();
    }
  } catch (error) {
    console.error('Error initializing auth:', error);
    showAuthScreen();
  }
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('main-app').classList.add('hidden');
}

async function showMainApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  
  // Update user info
  document.getElementById('user-email').textContent = currentUser.email;
  
  // Show admin badge if user is admin
  if (isAdmin()) {
    document.getElementById('admin-badge').classList.remove('hidden');
  } else {
    document.getElementById('admin-badge').classList.add('hidden');
  }
  
  // Load and show level selection
  await loadUserData();
  showLevelSelection();
}

function showLoginForm() {
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('register-form').classList.add('hidden');
  clearAuthErrors();
}

function showRegisterForm() {
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('register-form').classList.remove('hidden');
  clearAuthErrors();
}

function clearAuthErrors() {
  document.getElementById('login-error').classList.add('hidden');
  document.getElementById('register-error').classList.add('hidden');
}

function showAuthError(formType, message) {
  const errorElement = document.getElementById(`${formType}-error`);
  errorElement.textContent = message;
  errorElement.classList.remove('hidden');
}

async function handleLogin(event) {
  event.preventDefault();
  
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  
  if (!email || !password) {
    showAuthError('login', 'Please fill in all fields.');
    return;
  }
  
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    });
    
    if (error) {
      showAuthError('login', error.message);
      return;
    }
    
    currentUser = data.user;
    await showMainApp();
  } catch (error) {
    console.error('Login error:', error);
    showAuthError('login', 'An error occurred during login.');
  }
}

async function handleRegister(event) {
  event.preventDefault();
  
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const confirmPassword = document.getElementById('register-confirm').value;
  
  if (!email || !password || !confirmPassword) {
    showAuthError('register', 'Please fill in all fields.');
    return;
  }
  
  if (password !== confirmPassword) {
    showAuthError('register', 'Passwords do not match.');
    return;
  }
  
  if (password.length < 6) {
    showAuthError('register', 'Password must be at least 6 characters long.');
    return;
  }
  
  try {
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password
    });
    
    if (error) {
      showAuthError('register', error.message);
      return;
    }
    
    if (data.user) {
      currentUser = data.user;
      await showMainApp();
    }
  } catch (error) {
    console.error('Registration error:', error);
    showAuthError('register', 'An error occurred during registration.');
  }
}

async function handleLogout() {
  try {
    await supabase.auth.signOut();
    currentUser = null;
    
    // Clear user-specific data
    userProgress = new Map();
    failedSteps = new Map();
    failedStepsQueue = [];
    stepsSinceLastFailed = 0;
    levels = [];
    words = [];
    
    showAuthScreen();
  } catch (error) {
    console.error('Logout error:', error);
  }
}

function isAdmin() {
  return currentUser && currentUser.email === ADMIN_EMAIL;
}

function requireAdmin() {
  if (!isAdmin()) {
    alert('This feature is only available to administrators.');
    return false;
  }
  return true;
}

// Data Loading Functions
async function loadUserData() {
  try {
    await Promise.all([
      loadLevels(),
      loadWords(),
      loadUserProgress()
    ]);
  } catch (error) {
    console.error('Error loading user data:', error);
  }
}

async function loadLevels() {
  try {
    const { data, error } = await supabase
      .from('levels')
      .select('*')
      .order('sort');
    
    if (error) throw error;
    
    levels = data || [];
  } catch (error) {
    console.error('Error loading levels:', error);
    levels = [];
  }
}

async function loadWords() {
  try {
    const { data, error } = await supabase
      .from('words')
      .select('*');
    
    if (error) throw error;
    
    words = data || [];
  } catch (error) {
    console.error('Error loading words:', error);
    words = [];
  }
}

async function loadUserProgress() {
  if (!currentUser) return;
  
  try {
    const { data, error } = await supabase
      .from('progress')
      .select('*')
      .eq('user_id', currentUser.id);
    
    if (error) throw error;
    
    userProgress = new Map();
    (data || []).forEach(progress => {
      userProgress.set(progress.word_id, progress);
    });
  } catch (error) {
    console.error('Error loading user progress:', error);
    userProgress = new Map();
  }
}

// Progress Management
async function updateWordProgress(wordId, isCorrect, currentStep = null) {
  if (!currentUser) return;
  
  const existingProgress = userProgress.get(wordId) || {
    user_id: currentUser.id,
    word_id: wordId,
    status: 'learning',
    last_review: null,
    next_review: null,
    ease_factor: 2.5,
    streak: 0,
    correct_count: 0,
    wrong_count: 0,
    current_step: 0,
    level: 0,
    is_learned: false
  };
  
  const now = new Date().toISOString();
  existingProgress.last_review = now;
  
  if (isCorrect) {
    existingProgress.correct_count++;
    existingProgress.streak++;
    
    if (currentStep !== null) {
      existingProgress.current_step = currentStep;
    }
    
    // Wenn alle 5 Schritte abgeschlossen sind, ins SRS System
    if (existingProgress.current_step >= 4) {
      existingProgress.level = Math.min(existingProgress.level + 1, SRS_INTERVALS.length - 1);
      const daysToAdd = SRS_INTERVALS[existingProgress.level];
      const nextReview = new Date();
      nextReview.setDate(nextReview.getDate() + daysToAdd);
      existingProgress.next_review = nextReview.toISOString();
      existingProgress.is_learned = true;
      existingProgress.status = 'learned';
    }
  } else {
    existingProgress.wrong_count++;
    existingProgress.streak = 0;
    
    // Bei Fehlern Level reduzieren
    if (existingProgress.is_learned) {
      existingProgress.level = Math.max(0, existingProgress.level - 1);
      const daysToAdd = SRS_INTERVALS[existingProgress.level];
      const nextReview = new Date();
      nextReview.setDate(nextReview.getDate() + daysToAdd);
      existingProgress.next_review = nextReview.toISOString();
    }
  }
  
  try {
    const { data, error } = await supabase
      .from('progress')
      .upsert(existingProgress)
      .select();
    
    if (error) throw error;
    
    if (data && data[0]) {
      userProgress.set(wordId, data[0]);
    }
  } catch (error) {
    console.error('Error updating word progress:', error);
  }
}

function getWordProgress(wordId) {
  return userProgress.get(wordId) || {
    current_step: 0,
    level: 0,
    next_review: null,
    correct_count: 0,
    wrong_count: 0,
    last_review: null,
    is_learned: false,
    streak: 0
  };
}

function isWordDueForReview(wordId) {
  const progress = getWordProgress(wordId);
  if (!progress.is_learned || !progress.next_review) return false;
  return new Date() >= new Date(progress.next_review);
}

function isWordDifficult(wordId) {
  const progress = getWordProgress(wordId);
  return progress.wrong_count >= DIFFICULT_THRESHOLD;
}

function getWordsForReview() {
  const reviewWords = [];
  
  levels.forEach(level => {
    const levelWords = words.filter(word => word.level_id === level.id);
    levelWords.forEach(word => {
      if (isWordDueForReview(word.id)) {
        reviewWords.push({
          ...word,
          levelName: level.name
        });
      }
    });
  });
  
  return reviewWords;
}

function getDifficultWords() {
  const difficultWords = [];
  
  levels.forEach(level => {
    const levelWords = words.filter(word => word.level_id === level.id);
    levelWords.forEach(word => {
      if (isWordDifficult(word.id)) {
        difficultWords.push({
          ...word,
          levelName: level.name
        });
      }
    });
  });
  
  return difficultWords;
}

function getNewWordsInLevel(levelId) {
  const levelWords = words.filter(word => word.level_id === levelId);
  
  return levelWords.filter(word => {
    const progress = getWordProgress(word.id);
    return !progress.is_learned && progress.current_step === 0;
  });
}

// Failed Steps Management mit verzögerter Wiederholung
function getFailedStepKey(wordId) {
  return wordId;
}

function hasFailedStep(wordId) {
  const key = getFailedStepKey(wordId);
  return failedSteps.has(key);
}

function getFailedStep(wordId) {
  const key = getFailedStepKey(wordId);
  return failedSteps.get(key);
}

function setFailedStep(wordId, stepNumber) {
  const key = getFailedStepKey(wordId);
  failedSteps.set(key, stepNumber);
  
  // Füge zur Warteschlange hinzu, aber nicht sofort verfügbar
  const failedItem = {
    wordId,
    stepNumber,
    wordIndex: findWordIndex(wordId)
  };
  
  // Entferne eventuell bereits vorhandenen Eintrag für dasselbe Wort
  failedStepsQueue = failedStepsQueue.filter(item => item.wordId !== wordId);
  
  // Füge neuen Eintrag hinzu
  failedStepsQueue.push(failedItem);
  
  // Reset der Schritte-Zählung
  stepsSinceLastFailed = 0;
}

function clearFailedStep(wordId) {
  const key = getFailedStepKey(wordId);
  failedSteps.delete(key);
  
  // Entferne auch aus der Warteschlange
  failedStepsQueue = failedStepsQueue.filter(item => item.wordId !== wordId);
}

function findWordIndex(wordId) {
  return sessionWords.findIndex(word => word.id === wordId);
}

function getNextFailedStep() {
  // Prüfe ob genug Schritte seit letztem Fehler vergangen sind
  if (stepsSinceLastFailed < STEPS_BEFORE_RETRY) {
    return null;
  }
  
  // Hole den ältesten fehlgeschlagenen Schritt
  if (failedStepsQueue.length > 0) {
    const failedItem = failedStepsQueue.shift();
    stepsSinceLastFailed = 0; // Reset für nächsten fehlgeschlagenen Schritt
    return failedItem;
  }
  
  return null;
}

function incrementStepCounter() {
  stepsSinceLastFailed++;
}

// UI Management
function showLevelSelection() {
  document.getElementById('level-selection').classList.remove('hidden');
  document.getElementById('learning-screen').classList.add('hidden');
  renderLevels();
  renderLevelManagement();
  updateModeCounts();
  updateOverallProgress();
}

function renderLevelManagement() {
  const levelManagement = document.getElementById('level-management');
  
  if (isAdmin()) {
    levelManagement.innerHTML = `
      <button class="manage-levels-btn" onclick="showLevelManager()">
        ⚙️ Manage Levels
      </button>
      <button class="manage-words-btn" onclick="showWordManager()">
        📝 Manage Words
      </button>
      <button class="manage-audio-btn" onclick="showAudioManager()">
        🎵 Manage Audio
      </button>
    `;
  } else {
    levelManagement.innerHTML = '';
  }
}

function updateModeCounts() {
  // Review Count
  const reviewWords = getWordsForReview();
  const reviewCount = document.getElementById('review-count');
  const reviewMode = document.getElementById('review-mode');
  
  if (reviewWords.length > 0) {
    reviewCount.textContent = `${reviewWords.length} words`;
    reviewCount.classList.remove('zero');
    reviewMode.classList.remove('disabled');
  } else {
    reviewCount.textContent = 'No words due';
    reviewCount.classList.add('zero');
    reviewMode.classList.add('disabled');
  }
  
  // Difficult Words Count
  const difficultWords = getDifficultWords();
  const difficultCount = document.getElementById('difficult-count');
  const difficultMode = document.getElementById('difficult-mode');
  
  if (difficultWords.length > 0) {
    difficultCount.textContent = `${difficultWords.length} words`;
    difficultCount.classList.remove('zero');
    difficultMode.classList.remove('disabled');
  } else {
    difficultCount.textContent = 'No difficult words';
    difficultCount.classList.add('zero');
    difficultMode.classList.add('disabled');
  }
}

function renderLevels() {
  const levelGrid = document.getElementById('level-grid');
  levelGrid.innerHTML = '';

  levels.forEach((level, index) => {
    const levelProgress = getLevelProgress(level.id);
    const newWords = getNewWordsInLevel(level.id);
    const isCompleted = levelProgress.completed === levelProgress.total;
    const isUnlocked = index === 0 || getLevelProgress(levels[index - 1].id).completed > 0;

    const levelItem = document.createElement('div');
    levelItem.className = `level-item ${!isUnlocked ? 'locked' : ''}`;
    
    if (isUnlocked && newWords.length > 0) {
      levelItem.onclick = () => startNewWordsMode(level.id);
    } else if (isUnlocked) {
      levelItem.style.opacity = '0.7';
      levelItem.style.cursor = 'default';
    }

    levelItem.innerHTML = `
      <div class="level-icon ${isCompleted ? 'completed' : ''}">
        ${isCompleted ? '' : `<span class="level-number">${level.sort || level.id}</span>`}
      </div>
      <div class="level-name">${level.name}</div>
      <div class="level-progress">${levelProgress.completed}/${levelProgress.total}</div>
      ${newWords.length > 0 ? `<div class="level-new-words">${newWords.length} new words</div>` : '<div class="level-new-words">All learned</div>'}
    `;

    levelGrid.appendChild(levelItem);
  });
}

function getLevelProgress(levelId) {
  const levelWords = words.filter(word => word.level_id === levelId);
  if (levelWords.length === 0) return { completed: 0, total: 0 };

  let completed = 0;
  levelWords.forEach(word => {
    const progress = getWordProgress(word.id);
    if (progress.is_learned) {
      completed++;
    }
  });

  return { completed, total: levelWords.length };
}

function updateOverallProgress() {
  let totalWords = words.length;
  let learnedCount = 0;

  words.forEach(word => {
    const progress = getWordProgress(word.id);
    if (progress.is_learned) {
      learnedCount++;
    }
  });

  document.getElementById('words-learned-count').textContent = learnedCount;
  document.getElementById('total-words-count').textContent = totalWords;

  const percentage = totalWords > 0 ? (learnedCount / totalWords) * 100 : 0;
  document.getElementById('progress').style.width = percentage + '%';
}

// Learning Modes
function startNewWordsMode(levelId) {
  currentLearningMode = 'new';
  currentLevelId = levelId;
  const level = levels.find(l => l.id === levelId);
  const newWords = getNewWordsInLevel(levelId);
  
  if (newWords.length === 0) {
    alert('No new words to learn in this level!');
    return;
  }
  
  sessionWords = newWords.slice(0, Math.min(10, newWords.length)); // Max 10 words per session
  sessionIndex = 0;
  sessionStats = { correct: 0, wrong: 0 };
  
  document.getElementById('level-selection').classList.add('hidden');
  document.getElementById('learning-screen').classList.remove('hidden');
  document.getElementById('current-mode-name').textContent = `${level.name} - New Words`;
  
  updateSessionProgress();
  showStep();
}

function startReviewMode() {
  const reviewWords = getWordsForReview();
  
  if (reviewWords.length === 0) {
    alert('No words due for review!');
    return;
  }
  
  currentLearningMode = 'review';
  currentLevelId = null; // Cross-level
  sessionWords = reviewWords.slice(0, Math.min(20, reviewWords.length)); // Max 20 words per session
  sessionIndex = 0;
  sessionStats = { correct: 0, wrong: 0 };
  
  document.getElementById('level-selection').classList.add('hidden');
  document.getElementById('learning-screen').classList.remove('hidden');
  document.getElementById('current-mode-name').textContent = 'Review Session';
  
  updateSessionProgress();
  showStep();
}

function startDifficultMode() {
  const difficultWords = getDifficultWords();
  
  if (difficultWords.length === 0) {
    alert('No difficult words to practice!');
    return;
  }
  
  currentLearningMode = 'difficult';
  currentLevelId = null; // Cross-level
  sessionWords = difficultWords.slice(0, Math.min(15, difficultWords.length)); // Max 15 words per session
  sessionIndex = 0;
  sessionStats = { correct: 0, wrong: 0 };
  
  document.getElementById('level-selection').classList.add('hidden');
  document.getElementById('learning-screen').classList.remove('hidden');
  document.getElementById('current-mode-name').textContent = 'Difficult Words';
  
  updateSessionProgress();
  showStep();
}

function updateSessionProgress() {
  document.getElementById('current-word-number').textContent = sessionIndex + 1;
  document.getElementById('total-session-words').textContent = sessionWords.length;
}

function getCurrentWord() {
  if (sessionIndex >= sessionWords.length) return null;
  return sessionWords[sessionIndex];
}

function nextSessionWord() {
  sessionIndex++;
  updateSessionProgress();
  
  if (sessionIndex >= sessionWords.length) {
    showSessionComplete();
  } else {
    showStep();
  }
}

function showSessionComplete() {
  const stepContent = document.getElementById('step-content');
  const accuracy = sessionStats.correct + sessionStats.wrong > 0 
    ? Math.round((sessionStats.correct / (sessionStats.correct + sessionStats.wrong)) * 100) 
    : 0;
  
  stepContent.innerHTML = `
    <div class="session-complete">
      <div class="session-complete-icon">🎉</div>
      <h2>Session Complete!</h2>
      <p>Great job! You've completed your ${currentLearningMode} session.</p>
      
      <div class="session-stats">
        <div class="stat-item">
          <span class="stat-number">${sessionStats.correct}</span>
          <div class="stat-label">Correct</div>
        </div>
        <div class="stat-item">
          <span class="stat-number">${sessionStats.wrong}</span>
          <div class="stat-label">Wrong</div>
        </div>
        <div class="stat-item">
          <span class="stat-number">${accuracy}%</span>
          <div class="stat-label">Accuracy</div>
        </div>
        <div class="stat-item">
          <span class="stat-number">${sessionWords.length}</span>
          <div class="stat-label">Words Practiced</div>
        </div>
      </div>
      
      <button class="continue-btn" onclick="backToLevels()">Continue Learning</button>
    </div>
  `;
}

function backToLevels() {
  showLevelSelection();
}

// Learning System
function showStep() {
  const stepContent = document.getElementById('step-content');
  const word = getCurrentWord();
  
  if (!word) {
    showSessionComplete();
    return;
  }

  const hasAudio = word.audio_url && word.audio_url.trim() !== '';
  
  // Für Review und Difficult Mode: Verwende einen zufälligen Schritt
  let currentStep;
  if (currentLearningMode === 'review' || currentLearningMode === 'difficult') {
    // Zufälliger Schritt zwischen 1-4 (nicht die Einführung)
    currentStep = Math.floor(Math.random() * 4) + 1;
  } else {
    // Für neue Wörter: Verwende den aktuellen Fortschritt
    const progress = getWordProgress(word.id);
    
    // Prüfe ob es einen fehlgeschlagenen Schritt gibt, der wiederholt werden muss
    const failedStep = getFailedStep(word.id);
    currentStep = failedStep || progress.current_step;
  }
  
  // Erstes Mal: Einführung (English + siSwati zeigen)
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
          <button class="audio-button" onclick="playAudio('${word.translation}')" ${!hasAudio ? 'disabled' : ''}>
            🔊
          </button>
          ${!hasAudio ? '<div style="font-size: 12px; color: #999; margin-top: 10px;">No audio available</div>' : ''}
        </div>
        
        <button class="next-button" onclick="nextStep()">Next</button>
      </div>
    `;
    
    // Automatisches Vorlesen bei neuen Wörtern
    if (hasAudio && currentLearningMode === 'new') {
      setTimeout(() => {
        playAudio(word.translation);
      }, 1000);
    }
    return;
  }
  
  // Zweites Mal: Text-basiertes Multiple Choice
  if (currentStep === 1) {
    const options = shuffle([
      word.translation,
      getRandomWrongAnswer(word.translation),
      getRandomWrongAnswer(word.translation),
      getRandomWrongAnswer(word.translation)
    ]);
    
    stepContent.innerHTML = `
      <div class="multiple-choice-section">
        <div class="question-header">Pick the correct answer</div>
        <div class="question-text">${word.term}</div>
        <div class="choices-grid">
          ${options.map((option, index) => 
            `<button class="choice-button" onclick="checkChoice('${option}', '${word.translation}', 1)">
              <span class="choice-number">${index + 1}</span>
              <span class="choice-text">${option}</span>
            </button>`
          ).join('')}
        </div>
        <div class="help-section">
          <button class="help-button" onclick="showHelp(1)">
            <span class="help-icon">?</span>
            <span class="help-text">I don't know</span>
          </button>
        </div>
        <div id="feedback" class="feedback hidden"></div>
      </div>
    `;
    return;
  }
  
  // Drittes Mal: Audio-basiertes Multiple Choice
  if (currentStep === 2) {
    const options = shuffle([
      word.term,
      getRandomWrongEnglishAnswer(word.term),
      getRandomWrongEnglishAnswer(word.term),
      getRandomWrongEnglishAnswer(word.term)
    ]);
    
    stepContent.innerHTML = `
      <div class="audio-choice-section">
        <div class="question-header">Choose the translation for what you hear</div>
        
        <div class="audio-player-section">
          <div class="audio-circle">
            <button class="large-audio-button" onclick="playAudio('${word.translation}')" ${!hasAudio ? 'disabled' : ''}>
              🔊
            </button>
          </div>
          ${!hasAudio ? '<div style="font-size: 14px; color: #999; margin-top: 10px;">No audio available - skipping to next step</div>' : ''}
        </div>
        
        <div class="choices-grid">
          ${options.map((option, index) => 
            `<button class="choice-button" onclick="checkAudioChoice('${option}', '${word.term}', 2)" ${!hasAudio ? 'disabled' : ''}>
              <span class="choice-number">${index + 1}</span>
              <span class="choice-text">${option}</span>
            </button>`
          ).join('')}
        </div>
        
        <div class="help-section">
          <button class="help-button" onclick="showAudioHelp(2)" ${!hasAudio ? 'disabled' : ''}>
            <span class="help-icon">?</span>
            <span class="help-text">I don't know</span>
          </button>
        </div>
        
        <div class="audio-controls">
          <button class="replay-button" onclick="playAudio('${word.translation}')" ${!hasAudio ? 'disabled' : ''}>
            🔄 Replay
          </button>
          ${!hasAudio ? '<button class="next-button" onclick="nextStep()" style="margin-left: 10px;">Skip to Next</button>' : ''}
        </div>
        
        <div id="feedback" class="feedback hidden"></div>
      </div>
    `;
    
    // Automatisch das Audio beim Start abspielen (nur wenn verfügbar)
    if (hasAudio) {
      setTimeout(() => {
        playAudio(word.translation);
      }, 500);
    }
    return;
  }
  
  // Viertes Mal: Eingabe (siSwati für englisches Wort)
  if (currentStep === 3) {
    stepContent.innerHTML = `
      <div class="input-section">
        <div class="question-text">Type the siSwati word for "${word.term}":</div>
        <input type="text" class="text-input" id="user-input" placeholder="Type here..." onkeypress="handleEnter(event)" oninput="checkInputRealtime()">
        <br>
        <button class="submit-button" onclick="checkInput(3)">Check</button>
        <div id="feedback" class="feedback hidden"></div>
      </div>
    `;
    
    // Focus auf Input setzen
    setTimeout(() => {
      document.getElementById('user-input').focus();
    }, 100);
    return;
  }
  
  // Fünftes Mal: Eingabe (siSwati für englisches Wort) - wie im Bild
  if (currentStep === 4) {
    stepContent.innerHTML = `
      <div class="typing-section">
        <div class="typing-header">Type the correct translation</div>
        <div class="english-word">${word.term}</div>
        <div class="language-indicator">SISWATI</div>
        <div class="typing-input-container">
          <input type="text" class="typing-input" id="typing-input" placeholder="" onkeypress="handleTypingEnter(event)" oninput="checkTypingRealtime()">
        </div>
        <div class="letter-hints">
          ${generateLetterHints(word.translation)}
        </div>
        <div id="typing-feedback" class="typing-feedback hidden"></div>
        <div id="wrong-answer-display" class="wrong-answer-display hidden"></div>
        <div id="next-button-container" class="next-button-container hidden">
          <button class="next-button-small" onclick="nextStep()">
            Next ▶
          </button>
        </div>
      </div>
    `;
    
    // Focus auf Input setzen
    setTimeout(() => {
      document.getElementById('typing-input').focus();
    }, 100);
    return;
  }
}

function generateLetterHints(word) {
  const letters = ['u', 's', 'n', 'g', 'i', 'f', 't', 'e', 'm', 'a', 'h', 'b', 'l', 'k', 'w'];
  return letters.map(letter => 
    `<button class="letter-hint" onclick="insertLetter('${letter}')">${letter}</button>`
  ).join('') + `<button class="letter-hint hint-button" onclick="showTypingHint()">💡 Hint</button>`;
}

function insertLetter(letter) {
  const input = document.getElementById('typing-input');
  if (input) {
    input.value += letter;
    input.focus();
    checkTypingRealtime();
  }
}

function showTypingHint() {
  const word = getCurrentWord();
  const input = document.getElementById('typing-input');
  const currentValue = input.value.toLowerCase();
  const correct = word.translation.toLowerCase();
  
  // Zeige den nächsten Buchstaben als Hint
  if (currentValue.length < correct.length) {
    const nextChar = correct[currentValue.length];
    input.value = currentValue + nextChar;
    input.focus();
    checkTypingRealtime();
  }
}

function checkTypingRealtime() {
  const word = getCurrentWord();
  const userInput = document.getElementById('typing-input').value.trim().toLowerCase();
  const correct = word.translation.toLowerCase();
  const feedback = document.getElementById('typing-feedback');
  
  if (userInput === correct && userInput.length > 0) {
    feedback.textContent = 'Correct!';
    feedback.className = 'typing-feedback correct';
    feedback.classList.remove('hidden');
    
    // Automatisch weiter nach 1.5 Sekunden
    setTimeout(() => {
      nextStep();
    }, 1500);
  } else {
    feedback.classList.add('hidden');
  }
}

function handleTypingEnter(event) {
  if (event.key === 'Enter') {
    const word = getCurrentWord();
    const userInput = document.getElementById('typing-input').value.trim().toLowerCase();
    const correct = word.translation.toLowerCase();
    
    if (userInput === correct) {
      const feedback = document.getElementById('typing-feedback');
      feedback.textContent = 'Correct!';
      feedback.className = 'typing-feedback correct';
      feedback.classList.remove('hidden');
      
      // Automatisch weiter nach 1.5 Sekunden
      setTimeout(() => {
        nextStep();
      }, 1500);
    } else {
      // Zeige falsche Antwort wie im Bild und markiere Schritt als fehlgeschlagen
      setFailedStep(word.id, 4);
      showWrongAnswerDisplay(userInput, word);
    }
  }
}

function showWrongAnswerDisplay(userAnswer, word) {
  const wrongDisplay = document.getElementById('wrong-answer-display');
  const nextButtonContainer = document.getElementById('next-button-container');
  const input = document.getElementById('typing-input');
  
  // Input deaktivieren
  input.disabled = true;
  
  wrongDisplay.innerHTML = `
    <div class="wrong-answer-label">YOUR ANSWER</div>
    <div class="wrong-answer-text">${userAnswer}</div>
    <div class="correct-answer-section">
      <div class="correct-answer-label">SISWATI</div>
      <div class="correct-answer-text">${word.translation}</div>
      <div class="correct-answer-english">${word.term}</div>
    </div>
  `;
  
  wrongDisplay.classList.remove('hidden');
  nextButtonContainer.classList.remove('hidden');
}

function playAudio(text) {
  const word = getCurrentWord();
  
  // Versuche zuerst Supabase Storage Audio zu verwenden
  if (word.audio_url && word.audio_url.trim() !== '') {
    const audio = new Audio(word.audio_url);
    
    // Visuelles Feedback während der Wiedergabe
    const audioButtons = document.querySelectorAll('.audio-button, .large-audio-button');
    audioButtons.forEach(button => {
      button.style.background = '#2980b9';
      button.style.transform = 'scale(1.1)';
    });
    
    audio.onended = () => {
      audioButtons.forEach(button => {
        button.style.background = '#3498db';
        button.style.transform = 'scale(1)';
      });
    };
    
    audio.play().catch(e => {
      console.error('Error playing uploaded audio:', e);
      // Fallback zu Text-to-Speech
      playTextToSpeech(text);
    });
    return;
  }
  
  // Fallback zu Text-to-Speech wenn keine Audio-Datei vorhanden
  playTextToSpeech(text);
}

function playTextToSpeech(text) {
  // Text-to-Speech API verwenden
  if ('speechSynthesis' in window) {
    // Stoppe vorherige Audio-Wiedergabe
    speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Versuche eine passende Stimme zu finden (falls verfügbar)
    const voices = speechSynthesis.getVoices();
    const preferredVoice = voices.find(voice => 
      voice.lang.includes('en') || voice.lang.includes('af')
    );
    
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }
    
    utterance.rate = 0.8; // Etwas langsamer sprechen
    utterance.pitch = 1;
    utterance.volume = 1;
    
    // Visuelles Feedback während der Wiedergabe
    const audioButtons = document.querySelectorAll('.audio-button, .large-audio-button');
    audioButtons.forEach(button => {
      button.style.background = '#2980b9';
      button.style.transform = 'scale(1.1)';
    });
    
    utterance.onend = () => {
      audioButtons.forEach(button => {
        button.style.background = '#3498db';
        button.style.transform = 'scale(1)';
      });
    };
    
    speechSynthesis.speak(utterance);
  } else {
    // Fallback: Visuelles Feedback wenn TTS nicht verfügbar
    const button = document.querySelector('.audio-button, .large-audio-button');
    if (button) {
      button.style.background = '#2980b9';
      setTimeout(() => {
        button.style.background = '#3498db';
      }, 1000);
    }
  }
}

async function nextStep() {
  const word = getCurrentWord();
  
  // Lösche fehlgeschlagenen Schritt wenn erfolgreich abgeschlossen
  clearFailedStep(word.id);
  
  // Erhöhe Schritt-Zähler für verzögerte Wiederholung
  incrementStepCounter();
  
  // Für neue Wörter: Aktualisiere Fortschritt
  if (currentLearningMode === 'new') {
    const progress = getWordProgress(word.id);
    const newStep = Math.min(progress.current_step + 1, 4);
    await updateWordProgress(word.id, true, newStep);
  }
  
  // Zur nächsten Vokabel in der Session
  nextSessionWord();
}

async function checkChoice(selected, correct, stepNumber) {
  const choices = document.querySelectorAll('.choice-button');
  const feedback = document.getElementById('feedback');
  const word = getCurrentWord();
  
  choices.forEach(button => {
    button.disabled = true;
    const choiceText = button.querySelector('.choice-text').textContent;
    if (choiceText === correct) {
      button.classList.add('correct');
    } else if (choiceText === selected && selected !== correct) {
      button.classList.add('wrong');
    }
  });
  
  const isCorrect = selected === correct;
  
  if (isCorrect) {
    feedback.textContent = '✅ Correct!';
    feedback.className = 'feedback correct';
    clearFailedStep(word.id);
    sessionStats.correct++;
  } else {
    feedback.textContent = `❌ Wrong. Correct answer: ${correct}`;
    feedback.className = 'feedback wrong';
    setFailedStep(word.id, stepNumber);
    sessionStats.wrong++;
  }
  
  // Aktualisiere SRS Fortschritt
  await updateWordProgress(word.id, isCorrect);
  
  feedback.classList.remove('hidden');
  
  // Automatisch weiter nach 2 Sekunden
  setTimeout(() => {
    nextStep();
  }, 2000);
}

async function checkAudioChoice(selected, correct, stepNumber) {
  const choices = document.querySelectorAll('.choice-button');
  const feedback = document.getElementById('feedback');
  const word = getCurrentWord();
  
  choices.forEach(button => {
    button.disabled = true;
    const choiceText = button.querySelector('.choice-text').textContent;
    if (choiceText === correct) {
      button.classList.add('correct');
    } else if (choiceText === selected && selected !== correct) {
      button.classList.add('wrong');
    }
  });
  
  const isCorrect = selected === correct;
  
  if (isCorrect) {
    feedback.textContent = '✅ Correct!';
    feedback.className = 'feedback correct';
    clearFailedStep(word.id);
    sessionStats.correct++;
  } else {
    feedback.textContent = `❌ Wrong. Correct answer: ${correct}`;
    feedback.className = 'feedback wrong';
    setFailedStep(word.id, stepNumber);
    sessionStats.wrong++;
  }
  
  // Aktualisiere SRS Fortschritt
  await updateWordProgress(word.id, isCorrect);
  
  feedback.classList.remove('hidden');
  
  // Automatisch weiter nach 2 Sekunden
  setTimeout(() => {
    nextStep();
  }, 2000);
}

async function showHelp(stepNumber) {
  const word = getCurrentWord();
  const feedback = document.getElementById('feedback');
  
  feedback.textContent = `The correct answer is: ${word.translation}`;
  feedback.className = 'feedback help';
  feedback.classList.remove('hidden');
  
  // Buttons deaktivieren
  const choices = document.querySelectorAll('.choice-button');
  choices.forEach(button => {
    button.disabled = true;
    const choiceText = button.querySelector('.choice-text').textContent;
    if (choiceText === word.translation) {
      button.classList.add('correct');
    }
  });
  
  // Markiere als fehlgeschlagen da Hilfe verwendet wurde
  setFailedStep(word.id, stepNumber);
  sessionStats.wrong++;
  
  // Aktualisiere SRS Fortschritt
  await updateWordProgress(word.id, false);
  
  // Automatisch weiter nach 3 Sekunden
  setTimeout(() => {
    nextStep();
  }, 3000);
}

async function showAudioHelp(stepNumber) {
  const word = getCurrentWord();
  const feedback = document.getElementById('feedback');
  
  feedback.textContent = `The correct answer is: ${word.term}`;
  feedback.className = 'feedback help';
  feedback.classList.remove('hidden');
  
  // Buttons deaktivieren
  const choices = document.querySelectorAll('.choice-button');
  choices.forEach(button => {
    button.disabled = true;
    const choiceText = button.querySelector('.choice-text').textContent;
    if (choiceText === word.term) {
      button.classList.add('correct');
    }
  });
  
  // Markiere als fehlgeschlagen da Hilfe verwendet wurde
  setFailedStep(word.id, stepNumber);
  sessionStats.wrong++;
  
  // Aktualisiere SRS Fortschritt
  await updateWordProgress(word.id, false);
  
  // Automatisch weiter nach 3 Sekunden
  setTimeout(() => {
    nextStep();
  }, 3000);
}

async function checkInput(stepNumber) {
  const word = getCurrentWord();
  const userInput = document.getElementById('user-input').value.trim().toLowerCase();
  const correct = word.translation.toLowerCase();
  const feedback = document.getElementById('feedback');
  const submitButton = document.querySelector('.submit-button');
  const input = document.getElementById('user-input');
  
  input.disabled = true;
  submitButton.disabled = true;
  
  const isCorrect = userInput === correct;
  
  if (isCorrect) {
    feedback.textContent = '✅ Correct!';
    feedback.className = 'feedback correct';
    clearFailedStep(word.id);
    sessionStats.correct++;
  } else {
    feedback.textContent = `❌ Wrong. Correct answer: ${word.translation}`;
    feedback.className = 'feedback wrong';
    setFailedStep(word.id, stepNumber);
    sessionStats.wrong++;
  }
  
  // Aktualisiere SRS Fortschritt
  await updateWordProgress(word.id, isCorrect);
  
  feedback.classList.remove('hidden');
  
  // Automatisch weiter nach 2 Sekunden
  setTimeout(() => {
    nextStep();
  }, 2000);
}

async function checkInputRealtime() {
  const word = getCurrentWord();
  const userInput = document.getElementById('user-input').value.trim().toLowerCase();
  const correct = word.translation.toLowerCase();
  const feedback = document.getElementById('feedback');
  
  if (userInput === correct && userInput.length > 0) {
    feedback.textContent = '✅ Correct!';
    feedback.className = 'feedback correct';
    feedback.classList.remove('hidden');
    
    // Lösche fehlgeschlagenen Schritt
    clearFailedStep(word.id);
    sessionStats.correct++;
    
    // Aktualisiere SRS Fortschritt
    await updateWordProgress(word.id, true);
    
    // Automatisch weiter nach 1 Sekunde
    setTimeout(() => {
      nextStep();
    }, 1000);
  } else {
    feedback.classList.add('hidden');
  }
}

function handleEnter(event) {
  if (event.key === 'Enter') {
    checkInput(3);
  }
}

function getRandomWrongAnswer(correct) {
  const allTranslations = words.map(word => word.translation).filter(translation => translation !== correct);
  if (allTranslations.length === 0) return "wrong answer";
  
  return allTranslations[Math.floor(Math.random() * allTranslations.length)];
}

function getRandomWrongEnglishAnswer(correct) {
  const allTerms = words.map(word => word.term).filter(term => term !== correct);
  if (allTerms.length === 0) return "wrong answer";
  
  return allTerms[Math.floor(Math.random() * allTerms.length)];
}

function shuffle(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

// Level Management Modal (Admin only)
async function showLevelManager() {
  if (!requireAdmin()) return;
  
  document.getElementById('level-manager-modal').classList.remove('hidden');
  renderLevelManager();
}

function hideLevelManager() {
  document.getElementById('level-manager-modal').classList.add('hidden');
  loadLevels().then(() => renderLevels());
}

function renderLevelManager() {
  const list = document.getElementById('level-manager-list');
  list.innerHTML = '';

  levels.forEach((level, index) => {
    const item = document.createElement('div');
    item.className = 'level-manager-item';
    item.innerHTML = `
      <div class="level-manager-number">${level.sort || level.id}</div>
      <input type="text" class="level-manager-input" value="${level.name}" 
             onchange="updateLevelName('${level.id}', this.value)">
      ${levels.length > 1 ? `<button class="delete-level-btn" onclick="deleteLevel('${level.id}')">Delete</button>` : ''}
    `;
    list.appendChild(item);
  });
}

async function updateLevelName(levelId, newName) {
  if (!isAdmin()) return;
  
  try {
    const { error } = await supabase
      .from('levels')
      .update({ name: newName })
      .eq('id', levelId);
    
    if (error) throw error;
    
    // Update local data
    const level = levels.find(l => l.id === levelId);
    if (level) {
      level.name = newName;
    }
  } catch (error) {
    console.error('Error updating level name:', error);
    alert('Error updating level name');
  }
}

async function deleteLevel(levelId) {
  if (!requireAdmin()) return;
  if (levels.length <= 1) return;
  
  if (!confirm('Are you sure you want to delete this level? This will also delete all words in this level.')) {
    return;
  }
  
  try {
    // Delete words in this level first
    const { error: wordsError } = await supabase
      .from('words')
      .delete()
      .eq('level_id', levelId);
    
    if (wordsError) throw wordsError;
    
    // Delete the level
    const { error: levelError } = await supabase
      .from('levels')
      .delete()
      .eq('id', levelId);
    
    if (levelError) throw levelError;
    
    // Update local data
    await loadLevels();
    await loadWords();
    renderLevelManager();
  } catch (error) {
    console.error('Error deleting level:', error);
    alert('Error deleting level');
  }
}

async function addNewLevel() {
  if (!requireAdmin()) return;
  
  const maxSort = Math.max(...levels.map(l => l.sort || 0), 0);
  
  try {
    const { data, error } = await supabase
      .from('levels')
      .insert({
        name: `siSwati ${maxSort + 1}`,
        sort: maxSort + 1
      })
      .select();
    
    if (error) throw error;
    
    if (data && data[0]) {
      levels.push(data[0]);
      renderLevelManager();
    }
  } catch (error) {
    console.error('Error adding level:', error);
    alert('Error adding level');
  }
}

// Word Management Modal (Admin only)
async function showWordManager() {
  if (!requireAdmin()) return;
  
  document.getElementById('word-manager-modal').classList.remove('hidden');
  populateLevelSelector();
  renderWordManager();
}

function hideWordManager() {
  document.getElementById('word-manager-modal').classList.add('hidden');
  loadWords().then(() => renderLevels());
}

function populateLevelSelector() {
  const select = document.getElementById('word-level-select');
  select.innerHTML = '';
  
  levels.forEach(level => {
    const option = document.createElement('option');
    option.value = level.id;
    option.textContent = level.name;
    select.appendChild(option);
  });
}

function renderWordManager() {
  const selectedLevelId = document.getElementById('word-level-select').value;
  const levelWords = words.filter(word => word.level_id === selectedLevelId);
  const list = document.getElementById('word-manager-list');
  
  if (!selectedLevelId) {
    list.innerHTML = '<div>No level selected</div>';
    return;
  }
  
  list.innerHTML = '';

  levelWords.forEach((word, index) => {
    const item = document.createElement('div');
    item.className = 'word-manager-item';
    item.innerHTML = `
      <div class="word-inputs">
        <input type="text" class="word-input english" value="${word.term}" 
               onchange="updateWord('${word.id}', 'term', this.value)"
               placeholder="English word">
        <input type="text" class="word-input siswati" value="${word.translation}" 
               onchange="updateWord('${word.id}', 'translation', this.value)"
               placeholder="siSwati translation">
      </div>
      <div class="word-controls">
        ${levelWords.length > 1 ? `<button class="delete-word-btn" onclick="deleteWord('${word.id}')">Delete</button>` : ''}
      </div>
    `;
    list.appendChild(item);
  });
}

async function updateWord(wordId, field, newValue) {
  if (!isAdmin()) return;
  
  try {
    const { error } = await supabase
      .from('words')
      .update({ [field]: newValue })
      .eq('id', wordId);
    
    if (error) throw error;
    
    // Update local data
    const word = words.find(w => w.id === wordId);
    if (word) {
      word[field] = newValue;
    }
  } catch (error) {
    console.error('Error updating word:', error);
    alert('Error updating word');
  }
}

async function deleteWord(wordId) {
  if (!requireAdmin()) return;
  
  if (!confirm('Are you sure you want to delete this word?')) {
    return;
  }
  
  try {
    const { error } = await supabase
      .from('words')
      .delete()
      .eq('id', wordId);
    
    if (error) throw error;
    
    // Update local data
    await loadWords();
    renderWordManager();
  } catch (error) {
    console.error('Error deleting word:', error);
    alert('Error deleting word');
  }
}

async function addNewWord() {
  if (!requireAdmin()) return;
  
  const selectedLevelId = document.getElementById('word-level-select').value;
  
  if (!selectedLevelId) {
    alert('Please select a level first');
    return;
  }
  
  try {
    const { data, error } = await supabase
      .from('words')
      .insert({
        level_id: selectedLevelId,
        term: "new word",
        translation: "new translation",
        audio_url: "",
        image_url: ""
      })
      .select();
    
    if (error) throw error;
    
    if (data && data[0]) {
      words.push(data[0]);
      renderWordManager();
    }
  } catch (error) {
    console.error('Error adding word:', error);
    alert('Error adding word');
  }
}

// Audio Management Modal (Admin only)
async function showAudioManager() {
  if (!requireAdmin()) return;
  
  document.getElementById('audio-manager-modal').classList.remove('hidden');
  renderAudioManager();
}

function hideAudioManager() {
  document.getElementById('audio-manager-modal').classList.add('hidden');
}

function renderAudioManager() {
  const list = document.getElementById('audio-manager-list');
  list.innerHTML = '';

  levels.forEach(level => {
    const levelWords = words.filter(word => word.level_id === level.id);
    levelWords.forEach(word => {
      const hasAudio = word.audio_url && word.audio_url.trim() !== '';
      
      const item = document.createElement('div');
      item.className = 'audio-manager-item';
      item.innerHTML = `
        <div class="audio-word-info">
          <div class="audio-word-english">${word.term}</div>
          <div class="audio-word-siswati">${word.translation}</div>
          <div class="audio-word-level">${level.name}</div>
        </div>
        <div class="audio-controls">
          <div class="audio-status ${hasAudio ? 'uploaded' : 'missing'}">
            ${hasAudio ? 'Uploaded' : 'Missing'}
          </div>
          <div class="audio-upload-container">
            <button class="audio-upload-btn ${hasAudio ? 'has-audio' : ''}" 
                    onclick="document.getElementById('audio-${word.id}').click()">
              ${hasAudio ? 'Replace' : 'Upload'}
            </button>
            <input type="file" 
                   id="audio-${word.id}"
                   class="audio-upload-input" 
                   accept="audio/mp3,audio/mpeg"
                   onchange="handleAudioUpload(this, '${word.id}')">
          </div>
          <button class="audio-play-btn" 
                  onclick="playUploadedAudio('${word.audio_url}')"
                  ${!hasAudio ? 'disabled' : ''}>
            ▶ Play
          </button>
          ${hasAudio ? `<button class="audio-delete-btn" onclick="deleteUploadedAudio('${word.id}')">Delete</button>` : ''}
        </div>
      `;
      list.appendChild(item);
    });
  });
}

async function handleAudioUpload(input, wordId) {
  if (!isAdmin()) return;
  
  const file = input.files[0];
  if (!file) return;

  if (!file.type.startsWith('audio/')) {
    alert('Please select an audio file (MP3).');
    return;
  }

  try {
    // Upload file to Supabase Storage
    const fileName = `${wordId}_${Date.now()}.mp3`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('audio')
      .upload(fileName, file);

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('audio')
      .getPublicUrl(fileName);

    // Update word with audio URL
    const { error: updateError } = await supabase
      .from('words')
      .update({ audio_url: urlData.publicUrl })
      .eq('id', wordId);

    if (updateError) throw updateError;

    // Update local data
    const word = words.find(w => w.id === wordId);
    if (word) {
      word.audio_url = urlData.publicUrl;
    }

    renderAudioManager();
  } catch (error) {
    console.error('Error uploading audio:', error);
    alert('Error uploading audio file');
  }
}

function playUploadedAudio(audioUrl) {
  if (!audioUrl) {
    alert('No audio file found for this word.');
    return;
  }

  const audio = new Audio(audioUrl);
  audio.play().catch(e => {
    console.error('Error playing audio:', e);
    alert('Error playing audio file.');
  });
}

async function deleteUploadedAudio(wordId) {
  if (!requireAdmin()) return;
  
  if (!confirm('Are you sure you want to delete this audio file?')) {
    return;
  }

  try {
    const word = words.find(w => w.id === wordId);
    if (!word || !word.audio_url) return;

    // Extract filename from URL
    const fileName = word.audio_url.split('/').pop();

    // Delete from Supabase Storage
    const { error: deleteError } = await supabase.storage
      .from('audio')
      .remove([fileName]);

    if (deleteError) throw deleteError;

    // Update word to remove audio URL
    const { error: updateError } = await supabase
      .from('words')
      .update({ audio_url: null })
      .eq('id', wordId);

    if (updateError) throw updateError;

    // Update local data
    word.audio_url = null;

    renderAudioManager();
  } catch (error) {
    console.error('Error deleting audio:', error);
    alert('Error deleting audio file');
  }
}

// Event Listeners für Modal
document.addEventListener('click', function(event) {
  if (event.target.id === 'level-manager-modal') {
    hideLevelManager();
  }
  if (event.target.id === 'word-manager-modal') {
    hideWordManager();
  }
  if (event.target.id === 'audio-manager-modal') {
    hideAudioManager();
  }
});

// Stimmen laden (für bessere TTS-Qualität)
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => {
    // Stimmen sind jetzt verfügbar
  };
}

// App initialisieren
document.addEventListener('DOMContentLoaded', function() {
  initializeAuth();
});
