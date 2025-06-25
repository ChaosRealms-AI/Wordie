import { useState, useEffect } from 'react';
import { Word } from '../types';
import { fetchNextWord, submitWordResponse } from '../api/wordApi';

export const useWordManager = () => {
    const [currentWord, setCurrentWord] = useState<Word | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadNextWord = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const word = await fetchNextWord();
            setCurrentWord(word);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async (action: 'forget' | 'remember' | 'master') => {
        if (!currentWord) return;
        try {
            await submitWordResponse(currentWord.id, action);
            await loadNextWord();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Submission failed');
        }
    };

    useEffect(() => {
        loadNextWord();
    }, []);

    return { currentWord, isLoading, error, handleSubmit, retry: loadNextWord };
};