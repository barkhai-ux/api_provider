/**
 * Re-mounted on every console navigation: the new page settles in with a
 * short, crisp lift (the sidebar and top bar stay put in the layout).
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-[fade-up_220ms_var(--ease-out)_both]">{children}</div>;
}
