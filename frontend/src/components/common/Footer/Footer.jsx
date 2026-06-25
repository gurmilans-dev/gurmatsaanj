import { Link } from 'react-router-dom';
import './Footer.css';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="app-container site-footer-inner">
      
        <p className="site-footer-text">
          Gurudwara Guru Nanak Darbar, Castelfranco Emilia, Italy.
        </p>
        <p className="site-footer-text">
          Watch daily live katha and kirtan on{' '}
          <a
            href="https://www.youtube.com/@GURMATSANCHARITALY"
            target="_blank"
            rel="noreferrer"
          >
            Gurmat Sanchar Italy
          </a>
          .
        </p>
        <p className="site-footer-text">
          Built in seva. Voice never leaves your device.
        </p>
        <nav className="site-footer-links" aria-label="Footer links">
          <Link to="/credits">Credits &amp; License</Link>
        </nav>
        <p className="site-footer-copy">© {new Date().getFullYear()} Gurmat Saanj</p>
      </div>
    </footer>
  );
}
