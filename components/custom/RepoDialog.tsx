import React, { useContext, useEffect, useMemo, useState } from 'react'
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from '../ui/button'
import axios from 'axios';
import { Input } from '../ui/input';
import { UserDetailContext } from '@/context/UserDetailContext';

export type Repo = {
    id: number;
    name: string;
    full_name: string;
    private_: boolean;
    html_url: string;
    description: string;
    language: string;
    updated_at: string;
    default_branch: string;
    owner: string;
}

function RepoDialog({
    setRefreshPage,
    openSignal = 0,
}: {
    setRefreshPage: (refresh: boolean) => void;
    openSignal?: number;
}) {

    const [repoList, setRepoList] = useState<Repo[]>([]);
    const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const { userDetail } = useContext(UserDetailContext);
    const [isOpen, setIsOpen] = useState(false);
    useEffect(() => {
        GetRepoList();
    }, [])

    useEffect(() => {
        if (openSignal > 0) {
            setIsOpen(true);
        }
    }, [openSignal]);

    const GetRepoList = async () => {
        const result = await axios.get('/api/github/repos');
        console.log(result.data);
        setRepoList(result.data);
    }

    const filteredRepoList = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();

        if (!q) return repoList;

        return repoList.filter(r => r.full_name.toLowerCase().includes(q));
    }, [searchTerm, repoList])

    const SaveRepoToDB = async () => {
        if (!selectedRepo) return;

        const result = await axios.post('/api/user-repo', {
            repoId: selectedRepo.id,
            name: selectedRepo.name,
            full_name: selectedRepo.full_name,
            private_: selectedRepo.private_,
            html_url: selectedRepo.html_url,
            description: selectedRepo.description,
            userId: userDetail?.id,
            owner: selectedRepo.owner,
            updatedAt: selectedRepo.updated_at,
            language: selectedRepo.language,
            default_branch: selectedRepo.default_branch,
        });

        console.log(result.data);

        try {
            (window as any).pendo?.track("repository_added", {
                repo_id: selectedRepo.id,
                repo_name: selectedRepo.name,
                repo_full_name: selectedRepo.full_name,
                repo_language: selectedRepo.language || "",
                repo_private: selectedRepo.private_,
                repo_owner: selectedRepo.owner,
                default_branch: selectedRepo.default_branch,
            });
        } catch (e) { /* ignore tracking errors */ }

        setIsOpen(false);
        setRefreshPage(true);
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => setIsOpen(open)}>
            <DialogTrigger>
                <Button className='w-full sm:w-auto'>+Add Repo</Button>
            </DialogTrigger>
            <DialogContent className='w-[calc(100vw-1rem)] max-w-xl p-4 sm:p-6'>
                <DialogHeader>
                    <DialogTitle>Add Repository</DialogTitle>
                    <DialogDescription>
                        Search and select one of your github repositories
                    </DialogDescription>
                </DialogHeader>
                <div>
                    <Input placeholder='Search Repos by Name' onChange={(event) => setSearchTerm(event.target.value)} />
                    {/* Repo List */}
                    <ul className='max-h-60 overflow-y-auto border rounded-xl mt-4'>
                        {filteredRepoList.map((repo) => (
                            <li key={repo.id} className={`p-3 sm:p-4 border-b hover:bg-gray-100 cursor-pointer break-words text-sm
                                ${selectedRepo?.id == repo.id ? 'bg-gray-100' : null}`}
                                onClick={() => setSelectedRepo(repo)}>{repo.full_name}</li>
                        ))}
                    </ul>
                </div>
                <DialogFooter className='flex gap-2 sm:gap-5'>
                    <DialogClose asChild>
                        <Button variant='outline' className='w-full sm:w-auto'>Cancel</Button>
                    </DialogClose>
                    <Button className='w-full sm:w-auto' onClick={() => SaveRepoToDB()}>Add</Button>
                </DialogFooter>
            </DialogContent>

        </Dialog>
    )
}

export default RepoDialog
