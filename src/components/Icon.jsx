const paths = {
  code: ['m8 5-7 7 7 7', 'm16 5 7 7-7 7', 'm14 3-4 18'],
  home: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  jwt: ['M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7z', 'm8 12 3 3 5-6'],
  diff: ['M8 3H4v18h4', 'M16 3h4v18h-4', 'M10 8h4', 'M12 6v4', 'M10 16h4'],
  json: ['M8 3H6v6l-3 3 3 3v6h2', 'M16 3h2v6l3 3-3 3v6h-2', 'M11 9h2', 'M11 15h2'],
  markdown: ['M3 5h18v14H3z', 'M6 15V9l3 3 3-3v6', 'M17 9v6', 'm15 13 2 2 2-2'],
  html: ['m8 5-7 7 7 7', 'm16 5 7 7-7 7'],
  xml: ['m7 6-6 6 6 6', 'm17 6 6 6-6 6', 'm14 4-4 16'],
  base64: ['M5 4h14v16H5z', 'M9 8h6', 'M9 12h6', 'M9 16h3'],
  url: ['M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2', 'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2'],
  timestamp: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20', 'M12 6v6l4 2'],
  hash: ['M8 3 6 21', 'M18 3 16 21', 'M3 8h18', 'M2 16h18'],
  uuid: ['M4 4h16v16H4z', 'M8 8h2', 'M14 8h2', 'M8 12h8', 'M8 16h2', 'M14 16h2'],
  search: ['M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14', 'm15 15 6 6'],
  arrow: ['M5 12h14', 'm14 7 5 5-5 5'],
  copy: ['M9 9h12v12H9z', 'M15 5V3H3v12h2'],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M4 16v5h16v-5'],
  upload: ['M12 16V4', 'm7 9 5-5 5 5', 'M4 16v5h16v-5'],
  moon: ['M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10'],
  sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2', 'm5 5 1.5 1.5', 'm17.5 17.5 1.5 1.5', 'm5 19 1.5-1.5', 'm17.5 6.5 1.5-1.5'],
  lock: ['M5 10h14v11H5z', 'M8 10V6a4 4 0 0 1 8 0v4', 'M12 14v3'],
  close: ['m6 6 12 12', 'M6 18 18 6'],
  swap: ['M3 7h18', 'm17 3 4 4-4 4', 'M21 17H3', 'm7 13-4 4 4 4'],
  menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
  check: ['m5 12 4 4L19 6'],
}

export default function Icon({ name, size = 18, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{(paths[name] || paths.code).map((path, i) => <path key={i} d={path} />)}</svg>
}
