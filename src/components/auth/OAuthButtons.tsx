import { getApiBaseUrl } from '../../lib/api/auth';

export function OAuthButtons({ next = '/dashboard' }: { next?: string }) {
  const base = getApiBaseUrl();
  const nextQuery = encodeURIComponent(next);
  const buttonClass = 'w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-xl border border-workspace-200 bg-white text-sm font-semibold text-workspace-700 hover:bg-workspace-50 focus:outline-none focus:ring-4 focus:ring-primary-100 transition-all';

  return (
    <div className="space-y-3">
      <a className={buttonClass} href={`${base}/api/auth/google?next=${nextQuery}`}>
        <span aria-hidden="true" className="text-base font-bold text-[#4285F4]">G</span>
        Continue with Google
      </a>
      <a className={buttonClass} href={`${base}/api/auth/github?next=${nextQuery}`}>
        <span aria-hidden="true" className="text-xs font-bold border border-workspace-400 rounded px-1 py-0.5">GH</span>
        Continue with GitHub
      </a>
    </div>
  );
}
