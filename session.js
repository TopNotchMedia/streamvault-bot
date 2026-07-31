const sessions = new Map();

function getSession(telegramId) {
  if (!sessions.has(telegramId)) {
    sessions.set(telegramId, { state: null, data: {} });
  }
  return sessions.get(telegramId);
}

function setSession(telegramId, state, data = {}) {
  sessions.set(telegramId, { state, data });
}

function clearSession(telegramId) {
  sessions.delete(telegramId);
}

module.exports = { sessions, getSession, setSession, clearSession };
