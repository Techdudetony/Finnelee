import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useAuth } from './auth/AuthContext';
import { userKey } from './auth/userStorage';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useSwipeToClose } from './hooks/useSwipeToClose';
import { resolveMotion, setSavedMotion, transitionTo } from './utils/motion';
import { buildCommands, isPaletteShortcut, waitForElement } from './utils/commands';
import { emptyData } from './data/sampleData';
import { syncBudgets } from './utils/budgeting';
import { recordSnapshot } from './utils/netWorth';
import AuthScreen from './components/AuthScreen';
import WelcomeSummary from './components/WelcomeSummary';
import RecoveryKeyDialog from './components/RecoveryKeyDialog';
import PayScheduleStep from './components/PayScheduleStep';
import { markTourEnded, markTourOffered, shouldOfferTour } from './utils/onboarding';
import {
  canRestore,
  checklistDone,
  checklistView,
  doneCount,
  GETTING_STARTED_ITEMS,
  markAcknowledged,
  markHidden,
  markShown,
  newlyDone,
  trackChecklist,
} from './utils/gettingStarted';
import CommandPalette, { shortcutLabel } from './components/CommandPalette';
import TourBoundary from './components/TourBoundary';
// The guided tour loads only when it's shown (offered once, or replayed), so it adds
// almost nothing to the app's first download. `let`: after a failed download it is
// made again, because lazy() remembers a failure and would never retry.
const loadTour = () => import('./components/GuidedTour');
let GuidedTour = lazy(loadTour);
import PageErrorBoundary from './components/PageErrorBoundary';
import Dashboard from './components/Dashboard';
import NetWorth from './components/NetWorth';
import Transactions from './components/Transactions';
import Budget from './components/Budget';
import DebtPlanner from './components/DebtPlanner';
import Forecast from './components/Forecast';
import Goals from './components/Goals';
import Bills from './components/Bills';
import Categories from './components/Categories';
import Settings from './components/Settings';
import Icon, { BrandMark } from './components/Icon';
 
// Navigation config. Adding a page = add a row here + a component.
const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', Component: Dashboard },
  { id: 'networth', label: 'Net Worth', icon: 'networth', Component: NetWorth },
  { id: 'transactions', label: 'Transactions', icon: 'transactions', Component: Transactions },
  { id: 'budget', label: 'Budget', icon: 'budget', Component: Budget },
  { id: 'debt', label: 'Debt Planner', icon: 'debt', Component: DebtPlanner },
  { id: 'forecast', label: 'Forecast', icon: 'forecast', Component: Forecast },
  { id: 'goals', label: 'Goals', icon: 'goals', Component: Goals },
  { id: 'bills', label: 'Bills', icon: 'bills', Component: Bills },
  { id: 'categories', label: 'Categories', icon: 'categories', Component: Categories },
  { id: 'settings', label: 'Settings', icon: 'settings', Component: Settings },
];
 
/** Top level: decides between a loading screen, the sign-in screen, and the app itself. */
export default function App() {
  const { user, loading } = useAuth();
 
  // A branded splash while the saved session is checked (usually a blink).
  if (loading) {
    return (
      <div className="splash" role="status">
        <div className="brand">
          <BrandMark size={28} /> Finnelee
        </div>
        <div className="splash-bar" aria-hidden="true" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  if (!user) return <AuthScreen />;
 
  // key={user.id} is important: when a different user signs in, React throws away
  // the old FinanceApp (and all its state) and mounts a fresh one that reads the
  // new user's storage keys. Without it, one user's data could leak into another's.
  return <FinanceApp key={user.id} user={user} />;
}
 
function FinanceApp({ user }) {
  const { signOut, freshLogin, clearFreshLogin, newRecoveryKey, clearNewRecoveryKey } = useAuth();
  const [page, setPage] = useState('dashboard');

  // Phones: the sidebar becomes a slide-in drawer opened from a menu button.
  const isMobile = useMediaQuery('(max-width: 760px)');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = isMobile && drawerOpen; // resizing to desktop closes it automatically
  const menuButtonRef = useRef(null);
  const navRef = useRef(null);
  const sidebarRef = useRef(null);
  const backdropRef = useRef(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  // On phones the open drawer follows a leftward swipe and closes (Escape and the close
  // button still work for keyboards and screen readers).
  useSwipeToClose(sidebarRef, backdropRef, drawer, closeDrawer);
  // Focus moves into the drawer when it opens, and back to the menu button when it closes.
  // Done after render: until then the target is still `inert` and can't take focus.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (drawer) navRef.current?.querySelector('.nav-item.active')?.focus();
    else if (wasOpen.current) menuButtonRef.current?.focus();
    wasOpen.current = drawer;
  }, [drawer]);
  // While open, Escape closes it.
  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  // `from` (optional) is the element that was tapped, such as a Dashboard card: at Full
  // motion it grows into the new page's title (see transitionTo in utils/motion.js).
  // flushSync applies the change at once, which the View Transition needs to capture it.
  const goTo = (id, from) => {
    if (id === page) return closeDrawer();
    transitionTo(
      () =>
        flushSync(() => {
          setPage(id);
          setDrawerOpen(false);
        }),
      from,
    );
  };

  // The active-page highlight is one element that slides to the selected item.
  // Measured before paint (layout effect), so it never jumps.
  const [indicator, setIndicator] = useState(null);
  useLayoutEffect(() => {
    const active = navRef.current?.querySelector('.nav-item.active');
    if (active) setIndicator({ top: active.offsetTop, height: active.offsetHeight });
  }, [page, isMobile]);

  // `inert` takes a whole area out of tab order and screen readers: the hidden drawer on
  // phones, or the page behind the drawer while it's open (that's the focus trap).
  const inert = (on) => (on ? { inert: '' } : {});
  // The summary pops up automatically right after signing in (not on every page refresh).
  const [showSummary, setShowSummary] = useState(freshLogin);
  // Optional pay schedule step: once, right after sign-up (after the recovery key).
  const [askPaySchedule, setAskPaySchedule] = useState(false);
  const recoveryKeyDone = () => {
    if (newRecoveryKey?.reason === 'signup' && !settings.paySchedule) setAskPaySchedule(true);
    clearNewRecoveryKey();
  };
  const closeSummary = () => {
    setShowSummary(false);
    clearFreshLogin();
  };
  const blank = emptyData(); // fallback values if a key is missing
 
  // Each slice of data is stored under this user's own keys: finnelee.<userId>.<slice>
  const [transactions, setTransactions] = useLocalStorage(
    userKey(user.id, 'transactions'),
    blank.transactions,
  );
  const [budgets, setBudgets] = useLocalStorage(userKey(user.id, 'budgets'), blank.budgets);
  const [debts, setDebts] = useLocalStorage(userKey(user.id, 'debts'), blank.debts);
  const [goals, setGoals] = useLocalStorage(userKey(user.id, 'goals'), blank.goals);
  const [bills, setBills] = useLocalStorage(userKey(user.id, 'bills'), blank.bills);
  // Net worth accounts. Older accounts and backups have none, which reads as [].
  const [accounts, setAccounts] = useLocalStorage(userKey(user.id, 'accounts'), blank.accounts);
  const [settings, setSettings] = useLocalStorage(userKey(user.id, 'settings'), blank.settings);
  // Accounts created before custom categories existed fall back to the starter set.
  const [categories, setCategories] = useLocalStorage(
    userKey(user.id, 'categories'),
    blank.categories,
  );
 
  // The Motion setting (Full / Calm / Off). Signing out goes back to the device default.
  // A layout effect, so a saved Calm/Off is in place before the first paint.
  useLayoutEffect(() => {
    setSavedMotion(settings.motion);
  }, [settings.motion]);
  useEffect(() => () => setSavedMotion(undefined), []);

  // A limit planned for next month becomes the active one once that month arrives.
  // syncBudgets returns the same object when nothing changed, so this doesn't loop.
  useEffect(() => {
    setBudgets((prev) => syncBudgets(prev, settings));
  }, [settings, setBudgets]);

  // Record this month's net worth totals whenever accounts or debts change.
  // recordSnapshot returns the same object when nothing changed, so this doesn't loop.
  useEffect(() => {
    setSettings((prev) => recordSnapshot(prev, accounts, debts));
  }, [accounts, debts, setSettings]);
 
  // Bundle everything into one object so every page gets the same single prop.
  const store = {
    user,
    transactions,
    setTransactions,
    budgets,
    setBudgets,
    debts,
    setDebts,
    goals,
    setGoals,
    bills,
    setBills,
    accounts,
    setAccounts,
    settings,
    setSettings,
    categories,
    setCategories,
    // Settings calls this after replacing all data (sample data, a backup, Clear), so
    // the checklist treats what arrived as already there, never as steps just finished.
    checklistReset: () => {
      checklistBefore.current = null;
    },
  };

  // ---------- Getting Started checklist (GettingStarted.jsx, utils/gettingStarted.js) ----------
  // Every step is derived from the data. Tracked here rather than on the Dashboard, so a
  // step finished on any page, or while the checklist is hidden, still counts.
  const checklistDoneNow = useMemo(
    () => checklistDone({ transactions, budgets, accounts, bills, goals, settings }),
    [transactions, budgets, accounts, bills, goals, settings],
  );
  const checklistBefore = useRef(null); // the last check this session; null = just loaded
  const [checklistCelebrate, setChecklistCelebrate] = useState(false); // this session only
  useEffect(() => {
    const previous = checklistBefore.current;
    checklistBefore.current = checklistDoneNow;
    const now = new Date().toISOString();
    const { settings: next, celebrate } = trackChecklist(settings, checklistDoneNow, previous, now);
    if (next !== settings)
      setSettings((s) => trackChecklist(s, checklistDoneNow, previous, now).settings);
    if (celebrate) {
      setChecklistCelebrate(true);
      setNotice('Getting started: all five steps are done.');
      return;
    }
    // A step finished while the checklist is showing is announced, on any page.
    const fresh = newlyDone(previous, checklistDoneNow);
    if (fresh.length && checklistView(next, checklistDoneNow) === 'checklist')
      setNotice(
        `Getting started: ${fresh.map((i) => i.title).join(', ')} done. ` +
          `${doneCount(checklistDoneNow)} of ${GETTING_STARTED_ITEMS.length} steps done.`,
      );
  }, [checklistDoneNow]);
  // Focus goes to the Dashboard greeting after the card goes away (Hide or Done).
  const focusDashboardHeading = () =>
    requestAnimationFrame(() => {
      const h = document.querySelector('main.content h1');
      h?.setAttribute('tabindex', '-1');
      h?.focus();
    });
  const checklistRestorable = canRestore(settings, checklistDoneNow);
  const checklist = {
    done: checklistDoneNow,
    celebrate: checklistCelebrate,
    onCelebrated: () => setChecklistCelebrate(false),
    restorable: checklistRestorable,
    hide: () => {
      setSettings((s) => markHidden(s, new Date().toISOString()));
      setNotice('Getting Started hidden. Bring it back from Settings or search.');
      focusDashboardHeading();
    },
    // Settings and the palette: show it again and put focus on its heading.
    show: () => {
      setSettings(markShown);
      openTask('dashboard', ['getting-started'], 'Getting Started');
    },
    acknowledge: () => {
      setSettings((s) => markAcknowledged(s, new Date().toISOString()));
      setChecklistCelebrate(false);
      focusDashboardHeading();
    },
  };
 
  // ---------- Command palette (Ctrl K, or ⌘K on a Mac) ----------
  // Opens pages, puts focus in a form field, or changes Motion. It never edits records.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteOpener = useRef(null); // focus goes back here when it closes
  const commands = useMemo(
    () => buildCommands(PAGES, { gettingStarted: checklistRestorable }),
    [checklistRestorable],
  );
  const [focusRequest, setFocusRequest] = useState(null); // { page, focus, label } from a command
  const focusPending = useRef(false); // a command is moving focus: don't restore it
  focusPending.current = focusRequest !== null;
  const pageNow = useRef(page); // read by the focus wait below, which outlives a render
  pageNow.current = page;
  const [notice, setNotice] = useState(''); // read out after a Motion change
  const openPalette = () => {
    paletteOpener.current = document.activeElement;
    setPaletteOpen(true);
  };
  // Closing without running anything: back to the opener. Skipped when a command is
  // already moving focus to its page, so the two can never race.
  const restoreFocus = () => {
    const back = paletteOpener.current;
    requestAnimationFrame(() => {
      if (!focusPending.current && back?.isConnected) back.focus();
    });
  };
  const closePalette = () => {
    setPaletteOpen(false);
    restoreFocus();
  };
  const runCommand = ({ action, label }) => {
    setPaletteOpen(false);
    if (action.type === 'motion') {
      setSettings((s) => ({ ...s, motion: action.level }));
      const name = { full: 'Full', calm: 'Calm', off: 'Off' }[action.level];
      setNotice(
        resolveMotion(action.level) === action.level
          ? `Motion set to ${name}.`
          : `Motion set to ${name}. Your device asks for reduced motion, so it plays as Calm.`,
      );
      restoreFocus();
      return;
    }
    // The palette closes first (above); focus returns to what opened it after the tour.
    if (action.type === 'tour') return startTour(true, paletteOpener.current);
    if (action.type === 'gettingStarted') return checklist.show();
    openTask(action.page, action.focus ?? [], label);
  };
  // Opens a page with focus in one of its fields (`focus`: data-focus-target names, first
  // match wins). Used by palette tasks and by the buttons in empty states.
  const openTask = (pageId, focus, label) => {
    focusPending.current = true;
    setFocusRequest({ page: pageId, focus, label });
    goTo(pageId);
  };

  // The shortcut works only here, in the signed-in app, and not while another dialog or
  // the phone menu is open. Pressed again, it closes the palette.
  useEffect(() => {
    const onKey = (e) => {
      if (!isPaletteShortcut(e)) return;
      if (paletteOpen) {
        e.preventDefault();
        closePalette();
      } else if (!drawer && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        openPalette();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Focus goes to a task's field (or, for "Go to", the page heading) once its page is
  // showing. It keeps checking each frame until the field appears, for up to 3 seconds.
  // Then the heading gets focus and the miss is announced. Either way the request is
  // cleared and the checking stops, so it can never steal focus later.
  useEffect(() => {
    if (!focusRequest) return undefined;
    const { page: target, focus, label } = focusRequest;
    // Where "Go to" lands: the page's h1 (on Dashboard, its greeting), or the error message
    // when the page couldn't be drawn. The page area itself is the last resort.
    const heading = () =>
      document.querySelector('main.content h1') ?? document.querySelector('main.content .empty-error');
    const onPage = () => pageNow.current === target;
    const focusHeading = () => {
      const h = heading() ?? document.querySelector('main.content');
      h?.setAttribute('tabindex', '-1');
      h?.focus();
    };
    return waitForElement(
      () => {
        if (!onPage()) return null;
        if (focus.length === 0) return heading();
        const main = document.querySelector('main.content');
        return focus
          .map((name) => main?.querySelector(`[data-focus-target="${name}"]`))
          .find(Boolean);
      },
      {
        onFound: (element) => {
          if (focus.length === 0) focusHeading();
          else element.focus();
          setFocusRequest(null);
        },
        onTimeout: () => {
          if (onPage()) {
            focusHeading();
            if (focus.length > 0)
              setNotice(`${label}: that field isn't available right now, so focus is on the page heading.`);
          }
          setFocusRequest(null);
        },
      },
    );
  }, [focusRequest]);

  // ---------- Guided tour (GuidedTour.jsx, utils/tour.js) ----------
  // Offered once to a new account, after the sign-up steps and the welcome summary.
  // Settings > Guided tour replays it for anyone. It always runs on the Dashboard.
  const [tour, setTour] = useState(null); // null, or { replay } while it's showing
  const tourOpener = useRef(null); // focus goes back here when it ends
  // `opener`: where focus goes back afterwards (default: whatever has focus now).
  const startTour = (replay, opener = document.activeElement) => {
    tourOpener.current = opener;
    if (!replay) setSettings((s) => markTourOffered(s, new Date().toISOString()));
    setPage('dashboard'); // no page transition: the tour fades in over it
    setDrawerOpen(false); // the tour never opens over the phone menu
    setTour({ replay });
  };
  // A first-run offer whose tour couldn't download isn't spent: it's offered again
  // next visit (not this one, which would just fail again). See tourFailed below.
  const tourLoadFailed = useRef(false);
  const otherDialog = newRecoveryKey || askPaySchedule || showSummary || paletteOpen;
  useEffect(() => {
    if (!otherDialog && !tour && !tourLoadFailed.current && shouldOfferTour(settings))
      startTour(false);
  });
  // `open` ({ page, focus, label }): Show me, or a page from Explore all features. It
  // moves focus itself; otherwise focus goes back to where it was, or the page heading.
  // A replay is recorded apart from the first run, so it never overwrites that result.
  // The tour couldn't download (or draw): say so and keep the app working. Nothing is
  // recorded as done or skipped. Browsers remember a failed download until the page
  // reloads, hence the advice; some do retry, which the fresh lazy() allows.
  const tourFailed = () => {
    GuidedTour = lazy(loadTour);
    if (!tour.replay) {
      tourLoadFailed.current = true;
      setSettings((s) => ({ ...s, onboarding: { ...s.onboarding, offeredAt: null } }));
    }
    setTour(null);
    setNotice("The guided tour couldn't load. Check your connection, reload the page, then replay it from Settings.");
    const back = tourOpener.current;
    requestAnimationFrame(() => back?.isConnected && back !== document.body && back.focus());
  };
  const endTour = (outcome, open) => {
    const replay = tour.replay;
    setSettings((s) => markTourEnded(s, outcome, new Date().toISOString(), { replay }));
    setTour(null);
    if (open) {
      if (outcome === 'showme') setNotice(`Tour closed. ${open.label}: the field is ready.`);
      return openTask(open.page, open.focus, open.label);
    }
    const back = tourOpener.current;
    requestAnimationFrame(() => {
      if (back?.isConnected && back !== document.body) return back.focus();
      const h = document.querySelector('main.content h1');
      h?.setAttribute('tabindex', '-1');
      h?.focus();
    });
  };

  const current = PAGES.find((p) => p.id === page) ?? PAGES[0];
  const { Component } = current; // Capitalized so JSX treats it as a component
 
  return (
    <div className={`layout ${drawer ? 'drawer-open' : ''}`}>
      <header className="mobile-bar" {...inert(drawer)}>
        <button
          ref={menuButtonRef}
          className="btn-icon menu-button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          aria-expanded={drawer}
          aria-controls="sidebar"
        >
          <Icon name="menu" size={22} />
        </button>
        <div className="brand" style={{ padding: 0 }}>
          <BrandMark /> Finnelee
        </div>
        <button
          className="btn-icon palette-phone"
          onClick={openPalette}
          aria-label="Search pages and tasks"
          aria-haspopup="dialog"
        >
          <Icon name="search" size={20} />
        </button>
      </header>
      {drawer && (
        <div
          ref={backdropRef}
          className="drawer-backdrop"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      <aside
        ref={sidebarRef}
        id="sidebar"
        className="sidebar"
        aria-label="Menu"
        {...inert(isMobile && !drawerOpen)}
      >
        <div className="brand">
          <BrandMark /> Finnelee
          {isMobile && (
            <button className="btn-icon drawer-close" onClick={closeDrawer} aria-label="Close menu">
              <Icon name="close" />
            </button>
          )}
        </div>
        {!isMobile && (
          <button
            className="palette-open"
            onClick={openPalette}
            aria-haspopup="dialog"
            aria-keyshortcuts="Control+K Meta+K"
          >
            <Icon name="search" size={18} />
            <span>Search</span>
            <kbd>{shortcutLabel()}</kbd>
          </button>
        )}
        <nav className="nav" aria-label="Main" ref={navRef}>
          <span
            className="nav-indicator"
            aria-hidden="true"
            style={
              indicator
                ? { transform: `translateY(${indicator.top}px)`, height: indicator.height }
                : { display: 'none' }
            }
          />
          {PAGES.map((p) => (
            <button
              key={p.id} // React needs a stable key for each item in a list
              data-tour={p.id} // what the guided tour highlights
              className={`nav-item ${p.id === page ? 'active' : ''}`}
              aria-current={p.id === page ? 'page' : undefined}
              onClick={() => goTo(p.id)}
            >
              <Icon name={p.icon} />
              <span>{p.label}</span>
            </button>
          ))}
        </nav>
        <div className="profile">
          {/* First letter of the name as a simple avatar */}
          <span className="avatar" aria-hidden>
            {user.name[0]?.toUpperCase()}
          </span>
          <div className="profile-text">
            <div className="small">{user.name}</div>
            <div className="small muted profile-email">{user.email}</div>
          </div>
          <button className="btn-icon small" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
 
      <main className="content" {...inert(drawer)}>
        {/* key={page}: a new page mounts fresh, so its entrance animation plays once per
            page switch and never on ordinary rerenders. */}
        <div key={page} className="page-enter">
          {/* The dashboard renders its own greeting, so skip the generic title there */}
          {page !== 'dashboard' && <h1 className="page-title">{current.label}</h1>}
          <PageErrorBoundary label={current.label} onHome={page !== 'dashboard' ? () => goTo('dashboard') : null}>
            <Component store={store} goTo={goTo} openTask={openTask} openSummary={() => setShowSummary(true)} startTour={() => startTour(true)} checklist={checklist} />
          </PageErrorBoundary>
        </div>
      </main>
 
      {/* Conditional rendering: a popup only exists in the page while it's open.
          A new recovery key comes first; the welcome summary waits until it's saved. */}
      {newRecoveryKey ? (
        <RecoveryKeyDialog
          recoveryKey={newRecoveryKey.key}
          reason={newRecoveryKey.reason}
          onDone={recoveryKeyDone}
        />
      ) : askPaySchedule ? (
        <PayScheduleStep store={store} onClose={() => setAskPaySchedule(false)} />
      ) : (
        showSummary && <WelcomeSummary store={store} goTo={goTo} onClose={closeSummary} />
      )}
      {tour && (
        <TourBoundary onFail={tourFailed}>
          <Suspense fallback={null}>
            <GuidedTour
              replay={tour.replay}
              phone={isMobile}
              pages={PAGES.map(({ id, label }) => ({ id, label }))}
              onEnd={endTour}
            />
          </Suspense>
        </TourBoundary>
      )}
      {paletteOpen && (
        <CommandPalette commands={commands} onRun={runCommand} onClose={closePalette} />
      )}
      <div role="status" className="sr-only">
        {notice}
      </div>
    </div>
  );
}
 