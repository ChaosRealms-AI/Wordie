import { Word, SubmitAction } from '../types';

const API_BASE = process.env.REACT_APP_API_BASE || '';

export const fetchNextWord = async (): Promise<Word | null> => {
    const response = await fetch(`${API_BASE}/api/next-word`);
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to fetch word');
    }
    const rawData = await response.json();

    if (rawData.status === 'complete') return null;

    if (!rawData.id || !rawData.word) {
        throw new Error('Invalid word data structure');
    }

    return {
        id: rawData.id,
        word: rawData.word,
        examples: rawData.examples || [],
        status: rawData.status,
        reviews: rawData.reviews,
        win_rate: rawData.win_rate
    };
};

export const submitWordResponse = async (wordId: string, action: SubmitAction): Promise<void> => {
    const response = await fetch(`${API_BASE}/api/submit-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word_id: wordId, action })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Submission failed');
    }
};

export const translateText = async (text: string): Promise<string> => {
    const response = await fetch(`${API_BASE}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Translation failed');
    }

    const data = await response.json();
    return data.translation;
};