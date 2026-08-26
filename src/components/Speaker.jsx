export function Speaker({ side }) {
  return (
    <div className={`speaker speaker--${side}`} aria-hidden="true">
      <div className="speaker__screws"><i /><i /><i /><i /></div>
      <div className="speaker__grille">
        <div className="speaker__cone">
          <div className="speaker__ring speaker__ring--outer" />
          <div className="speaker__ring speaker__ring--inner" />
          <div className="speaker__dust-cap">
            <span>CB</span>
          </div>
        </div>
      </div>
      <span className="speaker__model">BASS REFLEX · 808 SERIES</span>
    </div>
  )
}

