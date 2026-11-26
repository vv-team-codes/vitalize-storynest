/* Vitalize StoryNest — mandatory Google sign-in gate (Firebase Auth).
   No guest access: the site stays locked until Firebase reports a signed-in user.
   If Firebase cannot load or the config is wrong, the gate shows a setup error
   and never pretends anyone is signed in. */
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

  function errEl() { return document.getElementById('authError'); }
  function btnEl() { return document.getElementById('googleSignInBtn'); }

  function showError(msg) {
    var el = errEl();
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }
  function clearError() {
    var el = errEl();
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  }
  function setLocked(locked) {
    document.body.classList.toggle('locked', locked);
    document.body.classList.toggle('signed-in', !locked);
  }
  function renderUser(user) {
    var chip = document.getElementById('userChip');
    if (!chip) return;
    if (!user) { chip.style.display = 'none'; return; }
    var photo = document.getElementById('userPhoto');
    var name = document.getElementById('userName');
    if (photo) { photo.src = user.photoURL || 'icon.svg'; photo.alt = user.displayName || 'Signed in'; }
    if (name) { name.textContent = user.displayName || user.email || 'Signed in'; }
    chip.style.display = 'inline-flex';
    chip.title = user.email || '';
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
    if (!auth) { showError('Google sign-in is not ready yet. Reload the page and try again.'); return; }
    if (signInBusy) return;
    signInBusy = true;
    clearError();
    setBtnBusy(true, 'Opening Google sign-in\u2026');
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(provider).then(function (result) {
      if (!result || !result.user) showError('Sign-in did not return a Google account. Please try again.');
    }).catch(function (e) {
      showError(friendlyError(e));
    }).finally(function () {
      signInBusy = false;
      setBtnBusy(false, 'Continue with Google');
    });
  }

  function signOutUser() {
    if (!auth) return;
    auth.signOut().catch(function (e) { showError('Sign-out failed: ' + (e && e.message ? e.message : 'please try again.')); });
  }

  window.startGoogleSignIn = startGoogleSignIn;
  window.signOutUser = signOutUser;
  window.vsnAuth = { getUser: function () { return currentUser; }, signIn: startGoogleSignIn, signOut: signOutUser };

  /* Any tap/click anywhere before sign-in opens the Google sign-in flow.
     Capture phase, so nav buttons, cards and links never reach their own handlers first. */
  document.addEventListener('click', function (e) {
    if (currentUser) return;
    var t = e.target;
    if (t && t.closest && t.closest('#authGate')) return; /* the gate's own button handles itself */
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    startGoogleSignIn();
  }, true);

  function init() {
    setLocked(true);
    renderUser(null);
    var b = btnEl();
    if (typeof firebase === 'undefined' || !firebase.auth) {
      showError('Google sign-in could not load (Firebase did not load). Check your connection and reload the page. The site stays locked until sign-in works.');
      if (b) b.disabled = true;
      return;
    }
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
      if (auth.setPersistence) auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {});
      auth.onAuthStateChanged(function (user) {
        currentUser = user || null;
        if (user) { clearError(); setLocked(false); renderUser(user); }
        else { setLocked(true); renderUser(null); }
      });
    } catch (e) {
      showError('Google sign-in is not configured correctly: ' + (e && e.message ? e.message : 'Firebase setup error.') + ' The site stays locked — no guest access.');
      if (b) b.disabled = true;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
