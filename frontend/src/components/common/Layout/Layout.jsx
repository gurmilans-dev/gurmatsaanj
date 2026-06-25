import Header from '../Header/Header';
import Footer from '../Footer/Footer';
import Toasts from '../Toasts/Toasts';
import LibraryDrawer from '../../../features/session/LibraryDrawer';
import CrashRecoveryManager from '../../../features/session/CrashRecoveryManager';
import LiveKeyboardShortcuts from '../../../features/session/LiveKeyboardShortcuts';
import './Layout.css';

export default function Layout({ children }) {
  return (
    <>
      <Header />
      <main className="site-main">
        {children}
      </main>
      <Footer />
      <Toasts />
      <LibraryDrawer />
      <CrashRecoveryManager />
      <LiveKeyboardShortcuts />
    </>
  );
}
