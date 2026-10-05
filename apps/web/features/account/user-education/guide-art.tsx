import type { GuideArticle } from '@drape/shared/guide-library'
export function GuideArt({
  kind,
  small = false,
}: {
  kind: GuideArticle['illustration']
  small?: boolean
}) {
  const paths: Record<GuideArticle['illustration'], string> = {
    sleeve:
      'M70 48 L106 35 L124 45 L145 86 L179 103 L168 124 L124 104 L102 72 M70 48 L65 145 L116 145 L111 94 M121 49 Q146 84 173 107',
    body: 'M102 44 a18 18 0 1 0 0 -36 a18 18 0 1 0 0 36 M82 49 L61 63 L44 111 L58 117 L77 84 L74 142 L129 142 L126 84 L145 117 L159 110 L142 63 L121 49 M75 95 L130 95 M77 118 L128 118',
    fabric:
      'M49 41 L141 24 L166 137 L74 155 Z M61 55 L139 41 M65 75 L143 61 M69 95 L147 81 M73 115 L151 101 M77 135 L155 121 M85 40 L109 142 M111 35 L135 137',
    care: 'M102 42 C80 42 86 16 105 19 C126 22 118 42 103 47 L103 57 L41 107 Q36 116 48 116 L162 116 Q174 116 167 107 L105 65 M65 132 L145 132 M78 146 L132 146',
    design:
      'M49 34 L152 34 L152 155 L49 155 Z M91 54 L73 65 L62 85 L77 93 L83 82 L75 132 L127 132 L119 82 L126 93 L140 85 L129 65 L111 54 Q101 68 91 54 M167 49 L176 57 L162 94',
  }
  return (
    <svg
      viewBox="0 0 210 175"
      role="img"
      aria-label={
        kind === 'sleeve'
          ? 'Schematic: tape follows the outer arm past a bent elbow.'
          : kind === 'body'
            ? 'Schematic body with horizontal circumference guides.'
            : kind === 'fabric'
              ? 'Illustration of a fabric swatch.'
              : kind === 'care'
                ? 'Illustration of a supported garment hanger.'
                : 'Illustration of a clothing design sheet.'
      }
      className={small ? 'h-24 w-full' : 'h-48 w-full'}
    >
      <rect width="210" height="175" rx="28" fill="#e7ebe0" />
      <circle cx="108" cy="87" r="65" fill="#f6f4ec" />
      <path
        d={paths[kind]}
        fill="none"
        stroke="#285546"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M32 145 L48 145 M40 137 L40 153" stroke="#ae794e" strokeWidth="2" />
    </svg>
  )
}
