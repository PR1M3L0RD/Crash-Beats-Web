export function SecretStation({ imageSrc, tunerPosition, onTune }) {
  return (
    <section className="secret-station" aria-label="Hidden radio station">
      <div className="secret-station__display" id="secret-station-message" role="status">
        <img
          className="secret-station__portrait"
          src={imageSrc}
          alt=""
          aria-hidden="true"
        />
        <span className="secret-station__message">
          <span>You found me!</span>
          <span>Creator: PR1M3L0RD</span>
        </span>
      </div>

      <input
        className="secret-station__tuner"
        type="range"
        min="88"
        max="108"
        step="0.1"
        value={tunerPosition}
        aria-label="Hidden station tuning dial"
        aria-describedby="secret-station-message"
        aria-valuetext={`${tunerPosition.toFixed(1)} FM`}
        onChange={(event) => onTune(Number(event.target.value))}
      />
    </section>
  )
}
