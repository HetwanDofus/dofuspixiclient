import { useMemo } from "react";

interface LoaderProps {
  percent?: number;
  label?: string;
}

const bannersCount = 24;

export default function Loader({ percent = 0, label = "Loading" }: LoaderProps) {
  const randomBanner = useMemo(
    () => Math.floor(Math.random() * bannersCount) + 1,
    []
  );

  return (
    <div className="loader">
      <img
        src={`/assets/loader/banners/${randomBanner}.png`}
        alt="Loading"
        className="loader__background"
      />
      <div className="loader__text">
        <img src="/assets/loader/loading.svg" alt="Loading" />
        <h2>
          Initializing <span className="loader__text--dofus">DOFUS</span>...
        </h2>
        <span>Dofus web 1.0.0 (2026)</span>
      </div>
      <div className="loader__space">
        <div className="loader__content">
          <div className="loader__line">
            Loading
            <div className="loader__bar">
              <div className="loader__bar_fill" style={{ width: `${percent}%` }} />
            </div>
            {percent}%
          </div>
          <div className="loader__line">
            {label}
            <div className="loader__bar">
              <div className="loader__bar_fill" style={{ width: `${percent}%` }} />
            </div>
            {percent}%
          </div>
        </div>
      </div>

      <style>{`
        .loader {
          width: 100%;
          height: 100%;
          position: relative;
          overflow: hidden;
        }
        .loader__background {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
          image-rendering: -webkit-optimize-contrast;
          image-rendering: optimizeQuality;
        }
        .loader__text {
          position: absolute;
          top: 10px;
          left: 10px;
          color: white;
          font-size: 13px;
          letter-spacing: -1px;
        }
        .loader__text img {
          height: 20px;
          margin: 0;
          animation: pulse 1.5s ease-in-out infinite;
        }
        .loader__text h2 {
          font-size: 15px;
          margin: 0;
          font-weight: 300;
        }
        .loader__text > span {
          margin-left: 20px;
          font-size: 13px;
          color: gray;
          font-weight: 300;
        }
        .loader__text--dofus {
          color: #ff9911;
        }
        .loader__space {
          width: 15vw;
          height: 8vh;
          background: rgba(48, 48, 46, 0.9);
          border-top-left-radius: 10px;
          border-top-right-radius: 10px;
          border: 2px solid #afafac;
          border-bottom: 0;
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
        }
        .loader__content {
          display: grid;
          align-items: center;
          justify-content: center;
          grid-template-columns: 100%;
          grid-template-rows: 1fr 1fr;
          gap: 10px;
          width: 90%;
          height: 100%;
          margin: auto;
        }
        .loader__line {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          width: calc(100% - 10px);
          margin: auto;
          font-size: 13px;
          color: white;
        }
        .loader__bar {
          width: 50%;
          height: 10px;
          padding: 1px;
          background: transparent;
          border: 1px solid #666666;
        }
        .loader__bar_fill {
          height: 100%;
          margin: auto;
          margin-left: 0;
          margin-right: 0;
          background: #99cc00;
          transition: width 0.5s ease;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
      `}</style>
    </div>
  );
}
