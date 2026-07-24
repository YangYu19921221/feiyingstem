import { motion } from 'framer-motion';
import { Gem } from 'lucide-react';
import type { PetStage } from '../config/petSpecies';

type PetArtworkProps = {
  image: string | null;
  stage?: PetStage;
  alt: string;
  containerClassName?: string;
  imageClassName?: string;
  eager?: boolean;
};

const shards = [
  { left: '5%', top: '22%', rotate: -18, delay: 0 },
  { right: '4%', top: '12%', rotate: 22, delay: 0.4 },
  { left: '13%', bottom: '6%', rotate: 15, delay: 0.8 },
  { right: '9%', bottom: '8%', rotate: -25, delay: 1.2 },
];

export default function PetArtwork({
  image,
  stage,
  alt,
  containerClassName = '',
  imageClassName = '',
  eager = false,
}: PetArtworkProps) {
  const isGem = Boolean(stage?.isGem);

  return (
    <div className={`relative flex items-center justify-center ${containerClassName}`}>
      {isGem && (
        <>
          <motion.div
            className="absolute inset-[4%] rounded-full bg-[conic-gradient(from_45deg,#22d3ee,#f9a8d4,#fde68a,#67e8f9,#22d3ee)] opacity-45 blur-md"
            animate={{ rotate: 360, scale: [0.96, 1.04, 0.96] }}
            transition={{ rotate: { repeat: Infinity, duration: 8, ease: 'linear' }, scale: { repeat: Infinity, duration: 2.4 } }}
          />
          {shards.map((shard, index) => (
            <motion.span
              key={index}
              className="absolute h-[18%] w-[9%] bg-cyan-200/90 shadow-[0_0_10px_rgba(34,211,238,0.8)]"
              style={{ ...shard, clipPath: 'polygon(50% 0, 100% 65%, 50% 100%, 0 65%)' }}
              animate={{ y: [0, -5, 0], opacity: [0.65, 1, 0.65] }}
              transition={{ repeat: Infinity, duration: 1.8, delay: shard.delay }}
            />
          ))}
        </>
      )}

      {image ? (
        <img
          src={image}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className={`relative z-[1] object-contain ${isGem ? 'saturate-125 contrast-110 drop-shadow-[0_0_12px_rgba(34,211,238,0.9)]' : ''} ${imageClassName}`}
        />
      ) : (
        <span className="relative z-[1] text-5xl" role="img" aria-label={alt}>🥚</span>
      )}

      {isGem && (
        <span className="absolute bottom-0 right-0 z-[2] flex h-7 w-7 items-center justify-center rounded-full bg-white text-cyan-500 shadow-md ring-2 ring-cyan-200">
          <Gem className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
    </div>
  );
}
