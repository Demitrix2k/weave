# Layouts

Each picture shows a 2560x1440 work area with 16 px gaps; the numbers are the window
order (1 is the first window of the context; monocle stacks all windows, so only the
last drawn shows through). `stage` is not a tree layout and is not drawn.

| layout | 1 | 2 | 3 | 4 | 5 | 7 |
|---|---|---|---|---|---|---|
| `master` | ![master 1](master-1.svg) | ![master 2](master-2.svg) | ![master 3](master-3.svg) | ![master 4](master-4.svg) | ![master 5](master-5.svg) | ![master 7](master-7.svg) |
| `columns` | ![columns 1](columns-1.svg) | ![columns 2](columns-2.svg) | ![columns 3](columns-3.svg) | ![columns 4](columns-4.svg) | ![columns 5](columns-5.svg) | ![columns 7](columns-7.svg) |
| `monocle` | ![monocle 1](monocle-1.svg) | ![monocle 2](monocle-2.svg) | ![monocle 3](monocle-3.svg) | ![monocle 4](monocle-4.svg) | ![monocle 5](monocle-5.svg) | ![monocle 7](monocle-7.svg) |
| `spiral` | ![spiral 1](spiral-1.svg) | ![spiral 2](spiral-2.svg) | ![spiral 3](spiral-3.svg) | ![spiral 4](spiral-4.svg) | ![spiral 5](spiral-5.svg) | ![spiral 7](spiral-7.svg) |
| `rows` | ![rows 1](rows-1.svg) | ![rows 2](rows-2.svg) | ![rows 3](rows-3.svg) | ![rows 4](rows-4.svg) | ![rows 5](rows-5.svg) | ![rows 7](rows-7.svg) |
| `hstack` | ![hstack 1](hstack-1.svg) | ![hstack 2](hstack-2.svg) | ![hstack 3](hstack-3.svg) | ![hstack 4](hstack-4.svg) | ![hstack 5](hstack-5.svg) | ![hstack 7](hstack-7.svg) |
| `rmaster` | ![rmaster 1](rmaster-1.svg) | ![rmaster 2](rmaster-2.svg) | ![rmaster 3](rmaster-3.svg) | ![rmaster 4](rmaster-4.svg) | ![rmaster 5](rmaster-5.svg) | ![rmaster 7](rmaster-7.svg) |
| `grid` | ![grid 1](grid-1.svg) | ![grid 2](grid-2.svg) | ![grid 3](grid-3.svg) | ![grid 4](grid-4.svg) | ![grid 5](grid-5.svg) | ![grid 7](grid-7.svg) |
| `ultrawide` | ![ultrawide 1](ultrawide-1.svg) | ![ultrawide 2](ultrawide-2.svg) | ![ultrawide 3](ultrawide-3.svg) | ![ultrawide 4](ultrawide-4.svg) | ![ultrawide 5](ultrawide-5.svg) | ![ultrawide 7](ultrawide-7.svg) |

Regenerate with `node core/tools/render-layouts.js` (no dependencies).
