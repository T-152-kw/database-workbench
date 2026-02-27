import React from 'react';

// Java版完整的SVG路径定义
const SVG_PATHS = {
  CONNECTION: "M14.75 12.125c-0.875 0-1.5625 0.0625-2.125 0.3125-0.1875 0.0625-0.4375 0.0625-0.4375 0.25l0.1875 0.375c0.125 0.1875 0.3125 0.5 0.5625 0.6875l0.6875 0.5 1.3125 0.625 0.6875 0.5625 0.375 0.25-0.1875-0.375-0.3125-0.3125c-0.3125-0.4375-0.6875-0.8125-1.125-1.125-0.375-0.1875-1.125-0.5625-1.25-0.9375h-0.0625l0.75-0.1875 1.125-0.1875 0.5-0.125v-0.125l-0.5625-0.625c-0.5-0.5-1.125-0.9375-1.75-1.375l-1.125-0.5c-0.125-0.0625-0.375-0.125-0.4375-0.25l-0.4375-0.8125-0.9375-1.875-0.5-1.25c-1.125-1.875-2.375-3-4.25-4.0625-0.375-0.25-0.875-0.3125-1.375-0.4375l-0.8125-0.0625-0.5-0.375C2.125 0.3125 0.5-0.5625 0.0625 0.5625c-0.3125 0.6875 0.4375 1.375 0.6875 1.75l0.5625 0.8125 0.1875 0.5625c0.1875 0.5 0.3125 1.0625 0.5625 1.5l0.375 0.625c0.125 0.125 0.25 0.1875 0.3125 0.375-0.1875 0.25-0.1875 0.5625-0.25 0.8125-0.4375 1.25-0.25 2.75 0.3125 3.6875 0.125 0.25 0.5625 0.875 1.125 0.625 0.5-0.1875 0.375-0.8125 0.5-1.375l0.0625-0.25 0.5 0.875c0.3125 0.5625 0.875 1.125 1.375 1.5 0.25 0.1875 0.5 0.5 0.8125 0.625l-0.25-0.25-0.5625-0.625c-0.5-0.625-0.875-1.3125-1.25-2l-0.4375-1.0625-0.1875-0.375c-0.1875 0.25-0.4375 0.4375-0.5625 0.75-0.1875 0.4375-0.1875 1.0625-0.25 1.625h-0.0625c-0.375-0.0625-0.5-0.4375-0.625-0.75-0.3125-0.75-0.375-2-0.0625-2.875 0.0625-0.25 0.375-0.9375 0.25-1.1875-0.0625-0.1875-0.25-0.3125-0.375-0.4375l-0.4375-0.75-0.625-1.875-0.5625-0.8125c-0.1875-0.3125-0.4375-0.5-0.625-0.875-0.0625-0.125-0.125-0.3125 0-0.4375l0.125-0.125c0.125-0.125 0.5625 0 0.6875 0.0625 0.375 0.1875 0.75 0.3125 1.0625 0.5625l0.5 0.375h0.25c0.375 0.0625 0.75 0 1.0625 0.125 0.5625 0.1875 1.125 0.4375 1.5625 0.75 1.4375 0.875 2.625 2.1875 3.375 3.6875 0.1875 0.25 0.1875 0.5 0.3125 0.75l0.75 1.625c0.25 0.5 0.4375 1 0.75 1.4375 0.1875 0.25 0.875 0.375 1.125 0.5l0.75 0.25 1.125 0.75c0.125 0.125 0.6875 0.4375 0.75 0.625Z",
  DB_BODY: "M2 4v8c0 1.1 2.7 2 6 2s6-.9 6-2V4",
  DB_TOP: "M 2 4 A 6 2 0 1 1 14 4 A 6 2 0 1 1 2 4",
  DB_MID: "M2 8c0 1.1 2.7 2 6 2s6-.9 6-2",
  LIGHTNING: "M 7 2 L 3 9 L 6 9 L 5 15 L 9 8 L 6 8 Z",
  TABLE_RECT: "M2 3 h12 v10 h-12 z",
  TABLE_LINES: "M2 6 h12 M6 3 v10",
  KEY_PRIMARY: "M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z",
  FIELD: "M8 2h8v20H8z",
  INDEX: "M3 17h18v2H3zm0-7h18v5H3zm0-4h18v2H3z",
  CHECK: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  FOREIGN_KEY: "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z",
  TRIGGER: "M7 2v11h3v9l7-12h-4l4-8z",
};

const COLORS = {
  CONNECTION_GRAY: "#808080",
  CONNECTION_ACTIVE: "#00546B",
  DOT_ACTIVE: "#28a745",
  DB_GRAY: "#808080",
  DB_GREEN: "#28a745",
  DB_OPEN_FILL: "#e0f7fa",
  SYSTEM_DB_ORANGE: "#ff6b35",
  SYSTEM_DB_BACKGROUND: "#fffacd",
  LIGHTNING_GOLD: "#ffd700",
  LIGHTNING_BORDER: "#ff8c00",
  TABLE_BLUE: "#007bff",
  VIEW_CYAN: "#17a2b8",
  FUNCTION_PINK: "#e83e8c",
  FOLDER_GRAY: "#6c757d",
};

interface IconProps {
  size?: number;
  className?: string;
}

export const MySqlConnectionIcon: React.FC<IconProps & { active?: boolean }> = ({
  active = false,
  size = 16,
  className = "",
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
    >
      <g>
        <path
          d={SVG_PATHS.CONNECTION}
          fill={active ? COLORS.CONNECTION_ACTIVE : COLORS.CONNECTION_GRAY}
          scale={0.9}
          transform="translate(-0.5, 1)"
        />
        {active && (
          <circle
            cx={13}
            cy={3}
            r={3}
            fill={COLORS.DOT_ACTIVE}
          />
        )}
      </g>
    </svg>
  );
};

export const DatabaseIcon: React.FC<IconProps & { opened?: boolean; isSystemDb?: boolean }> = ({
  opened = false,
  isSystemDb = false,
  size = 16,
  className = "",
}) => {
  const dbColor = opened ? COLORS.DB_GREEN : (isSystemDb ? COLORS.SYSTEM_DB_ORANGE : COLORS.DB_GRAY);
  const topFill = opened ? COLORS.DB_GREEN : (isSystemDb ? COLORS.SYSTEM_DB_ORANGE : COLORS.DB_GRAY);
  const bodyFill = opened ? COLORS.DB_OPEN_FILL : (isSystemDb ? COLORS.SYSTEM_DB_BACKGROUND : "transparent");

  return (
    <svg
      width={20}
      height={size}
      viewBox="0 0 20 16"
      className={className}
      style={{ marginRight: '4px' }}
    >
      <g>
        <path d={SVG_PATHS.DB_BODY} fill={bodyFill} stroke={dbColor} />
        <path d={SVG_PATHS.DB_TOP} fill={topFill} />
        <path d={SVG_PATHS.DB_MID} fill="transparent" stroke={dbColor} />
        {isSystemDb && (
          <path
            d={SVG_PATHS.LIGHTNING}
            fill={COLORS.LIGHTNING_GOLD}
            stroke={COLORS.LIGHTNING_BORDER}
            strokeWidth={0.5}
            transform="translate(12, -2) scale(0.6)"
          />
        )}
      </g>
    </svg>
  );
};

export const FolderIcon: React.FC<IconProps & { type: 'table' | 'view' | 'function' }> = ({
  type = 'table',
  size = 24,
  className = "",
}) => {
  const color = type === 'table' ? COLORS.TABLE_BLUE :
               type === 'view' ? COLORS.VIEW_CYAN :
               COLORS.FUNCTION_PINK;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{ marginRight: '4px' }}
    >
      <path
        d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
        fill={color}
      />
    </svg>
  );
};

export const TableIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      style={{ marginRight: '4px' }}
    >
      <g>
        <path d={SVG_PATHS.TABLE_RECT} fill="transparent" stroke={COLORS.TABLE_BLUE} />
        <path d={SVG_PATHS.TABLE_LINES} stroke={COLORS.TABLE_BLUE} />
      </g>
    </svg>
  );
};

export const ViewIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      style={{ marginRight: '4px' }}
    >
      <g>
        <path d={SVG_PATHS.TABLE_RECT} fill="transparent" stroke={COLORS.VIEW_CYAN} />
        <path d={SVG_PATHS.TABLE_LINES} stroke={COLORS.VIEW_CYAN} />
        <circle cx={5} cy={10} r={2} fill="transparent" stroke={COLORS.VIEW_CYAN} strokeWidth={1.5} />
        <circle cx={11} cy={10} r={2} fill="transparent" stroke={COLORS.VIEW_CYAN} strokeWidth={1.5} />
        <line x1={7} y1={10} x2={9} y2={10} stroke={COLORS.VIEW_CYAN} />
      </g>
    </svg>
  );
};

export const FunctionIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => {
  return (
    <svg
      width={22}
      height={size}
      viewBox="0 0 22 16"
      className={className}
      style={{ marginRight: '4px' }}
    >
      <text
        x="0"
        y="12"
        fill={COLORS.FUNCTION_PINK}
        fontSize="10"
        fontFamily="Consolas"
        fontWeight="bold"
      >
        f(x)
      </text>
    </svg>
  );
};

export const IndexIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{ marginRight: '4px' }}
    >
      <path d={SVG_PATHS.INDEX} fill="#28a745" />
    </svg>
  );
};

export const ForeignKeyIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{ marginRight: '4px' }}
    >
      <path d={SVG_PATHS.FOREIGN_KEY} fill="#17a2b8" />
    </svg>
  );
};

export const CheckIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{ marginRight: '4px' }}
    >
      <path d={SVG_PATHS.CHECK} fill="#6610f2" />
    </svg>
  );
};

export const TriggerIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{ marginRight: '4px' }}
    >
      <path d={SVG_PATHS.TRIGGER} fill="#ffc107" />
    </svg>
  );
};

export const FieldIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{ marginRight: '4px' }}
    >
      <path d={SVG_PATHS.FIELD} fill="#5f9ea0" />
    </svg>
  );
};

export const FieldListIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => {
  const color = COLORS.TABLE_BLUE;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      style={{ marginRight: '4px' }}
    >
      <g>
        <path d="M2 6 h4 v7 h-4 z" fill={color} />
        <path d={SVG_PATHS.TABLE_RECT} fill="transparent" stroke={color} />
        <path d={SVG_PATHS.TABLE_LINES} stroke={color} />
      </g>
    </svg>
  );
};

export const KeyIcon: React.FC<IconProps & { keyType?: string }> = ({
  keyType,
  size = 16,
  className = "",
}) => {
  let path = SVG_PATHS.FIELD;
  let color = "#5f9ea0";

  if (keyType === 'PRI') {
    path = SVG_PATHS.KEY_PRIMARY;
    color = "#FFD700";
  } else if (keyType === 'UNI') {
    path = SVG_PATHS.KEY_PRIMARY;
    color = "#C0C0C0";
  } else if (keyType === 'MUL') {
    path = SVG_PATHS.INDEX;
    color = "#808080";
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
    >
      <path d={path} fill={color} />
    </svg>
  );
};

export const ParamIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
    >
      <circle cx={8} cy={8} r={3} fill="#969696" />
    </svg>
  );
};
