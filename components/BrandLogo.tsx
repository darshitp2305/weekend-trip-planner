import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  variant?: "horizontal" | "stacked" | "icon";
  href?: string;
  className?: string;
  priority?: boolean;
};

const logoAssets = {
  horizontal: {
    src: "/branding/trippify-logo-horizontal.png",
    darkSrc: "/branding/trippify-logo-horizontal-dark-clean.png",
    alt: "Trippify logo",
    width: 857,
    height: 268,
  },
  stacked: {
    src: "/branding/trippify-logo-stacked.png",
    darkSrc: "/branding/trippify-logo-stacked-dark-clean.png",
    alt: "Trippify stacked logo",
    width: 541,
    height: 560,
  },
  icon: {
    src: "/branding/trippify-icon.png",
    darkSrc: "/branding/trippify-icon-white.png",
    alt: "Trippify icon",
    width: 256,
    height: 256,
  },
} as const;

export default function BrandLogo({
  variant = "horizontal",
  href,
  className,
  priority = false,
}: BrandLogoProps) {
  const asset = logoAssets[variant];
  const imageClassName = className ?? "h-auto w-auto";

  const image = (
    <span className="inline-flex items-center">
      <Image
        src={asset.src}
        alt={asset.alt}
        width={asset.width}
        height={asset.height}
        priority={priority}
        className={`${imageClassName} dark:hidden`}
      />
      <Image
        src={asset.darkSrc}
        alt={asset.alt}
        width={asset.width}
        height={asset.height}
        priority={priority}
        className={`${imageClassName} hidden dark:block`}
      />
    </span>
  );

  if (!href) {
    return image;
  }

  return (
    <Link href={href} aria-label="Trippify home">
      {image}
    </Link>
  );
}
