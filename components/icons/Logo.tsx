export function Logo({ class: className }: { class?: string }) {
  return (
    <svg
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 7 7"
      class={className}
    >
      <path
        d="M0,3 1,3 1,4 0,4 M2,3 3,3 3,4 2,4 M1,3 2,3 2,4 1,4 M3,0 4,0 4,1 3,1 M3,1 4,1 4,2 3,2 M3,2 4,2 4,3 3,3 M1,1 2,1 2,2 1,2 M2,2 3,2 3,3 2,3 M4,2 5,2 5,3 4,3 M5,1 6,1 6,2 5,2 M4,3 5,3 5,4 4,4 M4,4 5,4 5,5 4,5 M3,4 4,4 4,5 3,5 M2,4 3,4 3,5 2,5 M3,3 4,3 4,4 3,4 M3,5 4,5 4,6 3,6 M3,6 4,6 4,7 3,7 M1,5 2,5 2,6 1,6 M5,5 6,5 6,6 5,6 M5,3 6,3 6,4 5,4 M6,3 7,3 7,4 6,4 "
        fill="currentColor"
      >
      </path>
    </svg>
  );
}
