export interface ExampleSentence {
    text: string;
    audio_path: string;
    source_hash: string;
}

export interface Word {
    id: string;
    word: string;
    examples: ExampleSentence[];
    status: 'new' | 'reviewing' | 'mastered';
    reviews: number;
    win_rate: number;
}

export type SubmitAction = 'forget' | 'remember' | 'master';