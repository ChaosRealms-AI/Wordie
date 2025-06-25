import { useState } from 'react';

export const useAudio = () => {
    const [isPlaying, setIsPlaying] = useState(false);

    const play = (audioPath: string) => {
        if (isPlaying) return;

        const relativePath = audioPath.replace(/^.*[\\/]public[\\/]audio[\\/]/i, '');
        const correctedPath = relativePath.replace(/[\\/]/g, '/');
        const audioUrl = `${window.location.protocol}//${window.location.hostname}:8000/${correctedPath}`;

        const audio = new Audio(audioUrl);
        audio.addEventListener('play', () => setIsPlaying(true));
        audio.addEventListener('ended', () => setIsPlaying(false));
        audio.play().catch(error => {
            console.error('Audio play failed:', error);
            throw new Error('Audio playback failed');
        });
    };

    return { play, isPlaying };
};