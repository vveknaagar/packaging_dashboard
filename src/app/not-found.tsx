import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Page not found</h1>
        <p className="sub">This page does not exist, or you do not have access to it.</p>
        <Link href="/" className="btn btn-primary">Go to dashboard</Link>
      </div>
    </div>
  );
}
