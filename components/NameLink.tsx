export interface NameLinkProps {
  name: string;
  url?: string;
}

export function NameLink({ name, url }: NameLinkProps) {
  if (url) {
    return <a href={url}>{name}</a>;
  }

  return <>{name}</>;
}
