// 服の写真。背景を切り抜いたもの (端末の中で作る blob:) を出す。できるまでは元の写真。
import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { cutoutUrl } from "./cutout";

export function Photo({
  src,
  alt,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string }) {
  const [cut, setCut] = useState<{ from: string; url: string } | null>(null);
  useEffect(() => {
    let live = true;
    void cutoutUrl(src).then((url) => {
      if (live) setCut({ from: src, url });
    });
    return () => {
      live = false;
    };
  }, [src]);
  return <img src={cut?.from === src ? cut.url : src} alt={alt} draggable={false} {...rest} />;
}
