export function WorkspaceSkeleton() {
  return <section className="workspace-skeleton" aria-busy="true" aria-label="Загрузка раздела">
    <p role="status">Загружаем данные…</p>
    <div className="skeleton-heading" aria-hidden="true" />
    <div className="skeleton-toolbar" aria-hidden="true" />
    {[0, 1, 2, 3, 4].map(row => <div className="skeleton-row" key={row} aria-hidden="true"><span /><span /><span /></div>)}
  </section>;
}
