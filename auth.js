/* Vitalize StoryNest — Google sign-in (Firebase Auth), v6.
   REVISED trigger (26 Nov 2026): the landing page is fully visible on load —
   no blocking gate. Google sign-in opens on ANY button/link tap while signed
   out. After sign-in every button works normally, and the tap's destination
   page opens. No guest use of the app itself: app pages only open after
   sign-in. If Firebase cannot load, the sign-in modal shows the error. */
(function () {
  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyBsjgGNMjSpuwfd8FUt2gHSs8IdKs8N4ho",
    authDomain: "vitalize-storynest.firebaseapp.com",
    projectId: "vitalize-storynest",
    storageBucket: "vitalize-storynest.firebasestorage.app",
    messagingSenderId: "728498471886",
    appId: "1:728498471886:web:d961caae3b7b97b940a19f"
  };
  var currentUser = null;
  var auth = null;
  var signInBusy = false;
  var pendingPage = null;

  function gateEl() { return document.getElementById('authGate'); }
  function errEl() { return document.getElementById('authError'); }
  function btnEl() { return document.getElementById('googleSignInBtn'); }

  function showGate() { var g = gateEl(); if (g) g.classList.add('show'); }
  function hideGate() { var g = gateEl(); if (g) g.classList.remove('show'); }
  function showError(msg) {
    var el = errEl();
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }
  function clearError() {
    var el = errEl();
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  }
  function setLocked(locked) {
    /* v5: landing is never hidden. 'locked' only means "not signed in yet". */
    document.body.classList.toggle('signed-in', !locked);
    document.body.classList.remove('locked');
  }
  function renderUser(user) {
    var chip = document.getElementById('userChip');
    if (chip) {
      if (!user) { chip.style.display = 'none'; }
      else {
        var photo = document.getElementById('userPhoto');
        var name = document.getElementById('userName');
        if (photo) { photo.src = user.photoURL || 'icon.svg'; photo.alt = user.displayName || 'Signed in'; }
        if (name) { name.textContent = user.displayName || user.email || 'Signed in'; }
        chip.style.display = 'inline-flex';
        chip.title = user.email || '';
      }
    }
  }
  function setBtnBusy(busy, label) {
    var b = btnEl();
    if (!b) return;
    b.disabled = busy;
    if (label) {
      var l = document.getElementById('googleBtnLabel');
      if (l) l.textContent = label; else b.textContent = label;
    }
  }

  function friendlyError(e) {
    var code = (e && e.code) || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Google sign-in was closed before finishing. Tap "Continue with Google" to try again.';
    if (code === 'auth/popup-blocked-by-browser') return 'Your browser blocked the Google sign-in popup. Allow popups for this site and try again.';
    if (code === 'auth/unauthorized-domain') return 'This site\u2019s domain is not authorised for Google sign-in. Add vv-team-codes.github.io in Firebase > Authentication > Settings > Authorised domains.';
    if (code === 'auth/operation-not-allowed') return 'Google sign-in is not enabled for this Firebase project. Enable Google in Firebase > Authentication > Sign-in method.';
    if (code === 'auth/network-request-failed') return 'Network error while reaching Google sign-in. Check your connection and try again.';
    if (code === 'auth/operation-not-supported-in-this-environment') return 'Google sign-in is not supported in this browser. Try Chrome or Edge.';
    return 'Google sign-in failed' + (e && e.message ? ': ' + e.message : '. Please try again.');
  }

  function startGoogleSignIn() {
    if (currentUser) return;
    if (!auth) { showGate(); showError('Google sign-in is not ready yet. Reload the page and try again.'); return; }
    if (signInBusy) return;
    signInBusy = true;
    clearError();
    setBtnBusy(true, 'Opening Google sign-in\u2026');
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(provider).then(function (result) {
      if (!result || !result.user) { showGate(); showError('Sign-in did not return a Google account. Please try again.'); }
    }).catch(function (e) {
      showGate();
      showError(friendlyError(e));
    }).finally(function () {
      signInBusy = false;
      setBtnBusy(false, 'Continue with Google');
    });
  }

  function signOutUser() {
    if (!auth) return;
    auth.signOut().catch(function (e) { showGate(); showError('Sign-out failed: ' + (e && e.message ? e.message : 'please try again.')); });
  }
  function closeAuthGate() { hideGate(); clearError(); }

  window.startGoogleSignIn = startGoogleSignIn;
  window.signOutUser = signOutUser;
  window.closeAuthGate = closeAuthGate;
  window.vsnAuth = { getUser: function () { return currentUser; }, signIn: startGoogleSignIn, signOut: signOutUser };

  /* ANY button/link tap while signed out opens Google sign-in (capture phase,
     so the tap never reaches its own handler first). Clicks on empty page
     background do nothing — the landing stays viewable. */
  document.addEventListener('click', function (e) {
    if (currentUser) return;
    var t = e.target;
    if (t && t.closest && t.closest('#authGate')) return; /* modal's own buttons handle themselves */
    var el = (t && t.closest) ? t.closest('button, a, input, select, textarea, label, [data-page], [role="button"]') : null;
    if (!el) return;
    var pg = el.getAttribute && el.getAttribute('data-page');
    if (!pg && el.getAttribute && el.getAttribute('onclick')) {
      var m = el.getAttribute('onclick').match(/go\('([^']+)'\)/);
      if (m) pg = m[1];
    }
    pendingPage = pg || null;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    startGoogleSignIn();
  }, true);

  function init() {
    /* v21: do NOT mark signed-in here — Firebase auth state is async, and
       marking signed-in optimistically flashed the post-login page for ~1s
       on open, then flipped back to the welcome page when auth said
       "signed out". The page starts signed-out (the default) until the
       first onAuthStateChanged resolves it. v26: the purple splash that
       used to hide the page while auth resolved is removed — the welcome
       hero shows immediately on load. */
    renderUser(null);
    var b = btnEl();
    if (typeof firebase === 'undefined' || !firebase.auth) {
      showError('Google sign-in could not load (Firebase did not load). Check your connection and reload the page.');
      if (b) b.disabled = true;
      return;
    }
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
      if (auth.setPersistence) auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {});
      auth.onAuthStateChanged(function (user) {
        currentUser = user || null;
        if (user) {
          clearError(); hideGate(); setLocked(false); renderUser(user); if(window.renderSimpleHome) window.renderSimpleHome();
          if (pendingPage) { var p = pendingPage; pendingPage = null; setTimeout(function () { if (window.go) window.go(p); }, 50); }
        } else {
          setLocked(true); renderUser(null);
        }
      });
    } catch (e) {
      showGate();
      showError('Google sign-in is not configured correctly: ' + (e && e.message ? e.message : 'Firebase setup error.'));
      if (b) b.disabled = true;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
