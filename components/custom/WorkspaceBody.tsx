"use client"
import { UserDetailContext } from '@/context/UserDetailContext'
import Image from 'next/image';
import { useContext, useEffect, useState } from 'react'
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import EmptyWorkspace from './EmptyWorkspace';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import RepoDialog from './RepoDialog';
import UserRepoList from './UserRepoList';
import VoiceCommandButton from '@/components/voice/VoiceCommandButton';
import { VoiceCommand, VoiceFilterStatus } from '@/lib/speechmatics/commandParser';

export type UserRepo = {
    id: number;
    repoId: number;
    name: string;
    fullName: string;
    private: boolean;
    htmlUrl: string;
    description: string;
    userId: number;
    owner: string;
    updatedAt: string;
    language: string;
    defaultBranch: string;
    targetDomain?: string;
    gloablInstruction?: string;
}

function WorkspaceBody() {


    const { userDetail } = useContext(UserDetailContext);
    const router = useRouter()
    const [token, setToken] = useState('');
    const [userRepoList, setUserRepoList] = useState<UserRepo[]>([]);
    const [loading, setLoading] = useState(true);
    const [repoDialogOpenSignal, setRepoDialogOpenSignal] = useState(0);
    const [voiceFilter, setVoiceFilter] = useState<VoiceFilterStatus>("all");
    const [voiceRunScope, setVoiceRunScope] = useState<"all" | "failed" | "selected">("all");
    const [voiceRunSignal, setVoiceRunSignal] = useState(0);
    const [voiceToast, setVoiceToast] = useState<string | null>(null);
    useEffect(() => {
        GetGithubUserToken();

    }, [])

    useEffect(() => {
        userDetail?.id && GetUserAddedRepoList();
    }, [userDetail?.id])

    const GetGithubUserToken = async () => {
        const result = await axios.get('/api/github/token');
        console.log(result.data.token)
        setToken(result.data.token);
    }

    const OnAddRepo = async () => {
        router.push('/api/github');
    }

    const showVoiceToast = (message: string) => {
        setVoiceToast(message);
        setTimeout(() => setVoiceToast(null), 2500);
    };

    const handleVoiceCommand = (command: VoiceCommand) => {
        switch (command.type) {
            case "RUN_TESTS":
                setVoiceRunScope(command.scope);
                setVoiceRunSignal((prev) => prev + 1);
                showVoiceToast(`Voice command: running ${command.scope} tests`);
                break;
            case "FILTER_RESULTS":
                setVoiceFilter(command.status);
                showVoiceToast(`Voice command: filter ${command.status}`);
                break;
            case "CONNECT_REPO":
                if (!token) {
                    showVoiceToast("Voice command: opening GitHub connect flow");
                    OnAddRepo();
                    break;
                }
                setRepoDialogOpenSignal((prev) => prev + 1);
                showVoiceToast("Voice command: opening repository picker");
                break;
            case "UNKNOWN":
            default:
                if (command.raw.trim().length >= 12) {
                    showVoiceToast("Command not recognized");
                }
                break;
        }
    };

    const GetUserAddedRepoList = async () => {
        setLoading(true);
        const result = await axios.get('/api/user-repo?userId=' + userDetail?.id);
        console.log(result.data);
        setUserRepoList(result.data);
        setLoading(false);
    }


    return (
        <div>
            <div className='flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center'>
                <h2 className='text-2xl sm:text-3xl lg:text-4xl font-medium'>Workspace</h2>
                <div className='flex flex-wrap items-center gap-2 sm:gap-3'>
                    <VoiceCommandButton onCommand={handleVoiceCommand} />
                    <h2 className='text-blue-800 bg-blue-100 px-2 py-1 rounded-lg text-sm'>
                        <span className='hidden min-[361px]:inline'>Remaining Credits: </span>
                        <span className='min-[361px]:hidden'>Credits: </span>
                        {userDetail?.credits}
                    </h2>
                </div>
            </div>


            <Card className={'mt-5 p-4 border rounded-lg'}>
                <div className='flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center'>
                    <div className='flex items-center gap-4 min-w-0'>
                    <Image src={'/github.png'} alt='github' width={40} height={40} />
                        <h2 className='text-base sm:text-lg leading-tight'>Connect Github & Add Repository</h2>
                    </div>
                    <div>

                        {!token ? <Button onClick={OnAddRepo} className='w-full sm:w-auto'>Setup</Button>
                            : <RepoDialog
                                openSignal={repoDialogOpenSignal}
                                setRefreshPage={(refresh: boolean) => GetUserAddedRepoList()}
                            />}
                    </div>
                </div>
            </Card>

            {loading ? (
                <div className='mt-10'>
                    <div className='my-3 bg-slate-200 animate-pulse w-32 h-6 rounded'></div>
                    {[1, 2, 3].map((item) => (
                        <div key={item} className='w-full h-16 bg-slate-200 animate-pulse rounded-xl mb-5'></div>
                    ))}
                </div>
            ) : userRepoList?.length === 0 ? (
                <Card className='mt-10'>
                    <CardContent>
                        <EmptyWorkspace />
                    </CardContent>
                </Card>
            ) : (
                <UserRepoList
                    repoList={userRepoList}
                    setReload={() => GetUserAddedRepoList()}
                    voiceFilter={voiceFilter}
                    voiceRunSignal={voiceRunSignal}
                    voiceRunScope={voiceRunScope}
                />
            )}

            {voiceToast && (
                <div className='fixed bottom-4 left-3 right-3 sm:left-auto sm:right-6 sm:bottom-6 z-50 rounded-md bg-gray-900 text-white px-4 py-2 text-sm shadow-lg'>
                    {voiceToast}
                </div>
            )}

        </div>
    )
}

export default WorkspaceBody
