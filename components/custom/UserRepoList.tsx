import React, { useContext, useState } from 'react'
import { UserRepo } from './WorkspaceBody'
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"
import Image from 'next/image'
import { CheckCircle2, Globe2Icon, Link2Icon, ListChecks, Loader2, Loader2Icon, Settings2, Sparkles, TrendingUp, XCircle } from 'lucide-react'
import { Button } from '../ui/button'
import axios from 'axios'
import { UserDetailContext } from '@/context/UserDetailContext'
import TestCaseList from './TestCaseList'
import RepoSettings from './RepoSettings'

type props = {
    repoList: UserRepo[],
    setReload: () => void;
    voiceFilter: "all" | "passing" | "failing";
    voiceRunSignal: number;
    voiceRunScope: "all" | "failed" | "selected";
}

export type TestCase = {
    id: number;
    title: string;
    description: string;
    type: string;
    repoId: number;
    targetFiles: string[];
    expectedResult: string;
    repoName: string;
    repoOwner: string;
    targetRoute: string;
    status: string;
    browserbaseScript: string;
}

type StatusData = {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    passRate: number;
}

function UserRepoList({
    repoList,
    setReload,
    voiceFilter,
    voiceRunSignal,
    voiceRunScope,
}: props) {

    const [statusData, setStatusData] = useState<StatusData>({
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        passRate: 0
    });


    const { userDetail, setUserDetail } = useContext(UserDetailContext);
    const [loading, setLoading] = useState(false);
    const [testCaseLoading, setTestCaseLoading] = useState(false);
    const [testCases, setTestCases] = useState<TestCase[]>([]);
    const [activeRepoId, setActiveRepoId] = useState<number | null>(null);
    const handleGenerateTestCases = async (repo: UserRepo) => {
        setLoading(true);
        try {
            // Implement the logic to call the API route to generate test cases for the selected repository
            const result = await axios.post('/api/generate-test-cases', {
                userId: userDetail?.id,
                repoId: repo?.repoId,
                owner: repo.owner,
                repo: repo.name,
                branch: repo.defaultBranch,
            });

            console.log(result.data);
            if (result.data.credits !== undefined) {
                setUserDetail({ ...userDetail, credits: result.data.credits });
            }
            
            // Reload test cases after generation
            GetTestCases(repo.repoId);
        } catch (error: any) {
            console.error(error);
            alert(error.response?.data?.error || "Failed to generate test cases");
        } finally {
            setLoading(false);
        }
    }

    const GetTestCases = async (repoId: number) => {
        // Implement the logic to fetch test cases for the selected repository and display them in a user-friendly format
        setTestCaseLoading(true);
        setTestCases([]);
        const result = await axios.get(`/api/test-cases?repoId=${repoId}`);
        console.log(result.data);
        const userTestCases = result.data as TestCase[];
        const passedTests = userTestCases?.filter(testCase => testCase.status == 'passed').length || 0;
        const failedTests = userTestCases?.filter(testCase => testCase.status == 'failed').length || 0;
        const passRate = userTestCases?.length ? Math.round((passedTests / userTestCases.length) * 100) : 0;


        setStatusData({
            totalTests: result.data.length,
            passedTests: passedTests,
            failedTests: failedTests,
            passRate: passRate
        })

        setTestCases(result.data);
        setTestCaseLoading(false);

    }

    return (
        <div className='mt-10'>
            <h2 className='my-3 font-medium'>REPOSITORIES</h2>
            <Accordion type="single" collapsible
                onValueChange={(value) => {
                    const parsed = Number(value);
                    setActiveRepoId(Number.isFinite(parsed) ? parsed : null);
                    if (value) {
                        GetTestCases(parsed);
                    } else {
                        setTestCases([]);
                    }
                }}
            >
                {repoList.map((repo) => (

                    <AccordionItem key={repo.repoId} value={(repo.repoId).toString()} className='border px-3 sm:px-5 rounded-xl mb-5'>
                        <AccordionTrigger>
                            <div className='flex items-center gap-3 sm:gap-5 min-w-0'>
                                <Image src={'/github.png'} alt='github' width={30} height={30} />
                                <div className='flex flex-col items-start gap-1 min-w-0'>
                                    <h2 className='font-medium text-sm sm:text-base truncate max-w-[70vw] sm:max-w-none'>{repo.fullName}</h2>
                                    <p className='text-xs text-gray-500 truncate max-w-[70vw] sm:max-w-none'>
                                        {repo.defaultBranch}   •   {repo.language}
                                    </p>
                                </div>

                            </div>

                        </AccordionTrigger>

                        <AccordionContent>
                            <div className='pt-4 space-y-5'>

                                <div className='bg-gray-50 p-3 border rounded-xl flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center'>
                                    <div className='flex gap-2 sm:gap-3 items-center min-w-0'>
                                        <Link2Icon className='text-primary' />
                                        <h2 className='text-sm shrink-0'>Target Domain:</h2>
                                        <h2 className='bg-white p-1 px-2 border rounded-md text-primary font-medium text-xs sm:text-sm truncate min-w-0'>{repo?.targetDomain || "Not configured"}</h2>
                                    </div>
                                    <div className='w-full sm:w-auto'>
                                        <RepoSettings repo={repo} setReload={setReload} />
                                    </div>
                                </div>
                                <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'>

                                    <StatusCard
                                        title="Total Tests"
                                        value={statusData?.totalTests}
                                        icon={<ListChecks className='h-5 w-5 text-blue-600' />}
                                        bgColor="bg-blue-50"
                                    />

                                    <StatusCard
                                        title="Passed"
                                        value={statusData?.passedTests}
                                        icon={<CheckCircle2 className='h-5 w-5 text-green-600' />}
                                        bgColor="bg-green-50"
                                    />

                                    <StatusCard
                                        title="Failed"
                                        value={statusData?.failedTests}
                                        icon={<XCircle className='h-5 w-5 text-red-600' />}
                                        bgColor="bg-red-50"
                                    />

                                    <StatusCard
                                        title="Pass Rate"
                                        value={`${statusData?.passRate}%`}
                                        icon={<TrendingUp className='h-5 w-5 text-purple-600' />}
                                        bgColor="bg-purple-50"
                                    />
                                </div>

                                {!testCaseLoading && testCases.length > 0
                                    && <TestCaseList testCases={testCases} onReload={(repoId: number) => GetTestCases(repoId)}
                                        repository={repo}
                                        voiceFilter={activeRepoId === repo.repoId ? voiceFilter : "all"}
                                        voiceRunSignal={activeRepoId === repo.repoId ? voiceRunSignal : 0}
                                        voiceRunScope={voiceRunScope}
                                    />}

                                {testCaseLoading ?
                                    <h2 className='flex gap-3 items-center text-sm'> <Loader2Icon className='animate-spin' /> Please Wait... </h2>
                                    :
                                    testCases?.length == 0 && <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-4 border rounded-xl p-4 bg-gray-50'>
                                        <div>
                                            <h3 className='font-medium'>
                                                {loading ? 'Generating Test Cases...' :
                                                    'Generate AI Test Cases'}</h3>
                                            <p className='text-sm text-gray-500 mt-1'>
                                                Analyze this repository and generate automated test cases using AI.
                                            </p>
                                        </div>

                                        <Button className='gap-2 w-full sm:w-auto'
                                            disabled={loading}
                                            onClick={() => handleGenerateTestCases(repo)}>
                                            {loading ? <Loader2 className='animate-spin' /> : <Sparkles className='h-4 w-4' />}
                                            Generate Test Cases
                                        </Button>
                                    </div>}
                            </div>
                        </AccordionContent>

                    </AccordionItem>

                ))}
            </Accordion>
        </div>
    )
}

export default UserRepoList



function StatusCard({
    title,
    value,
    icon,
    bgColor
}: {
    title: string
    value: string | number
    icon: React.ReactNode
    bgColor: string
}) {
    return (
        <div className='border rounded-xl p-3 sm:p-4 flex items-center justify-between bg-white'>
            <div>
                <p className='text-sm text-gray-500'>{title}</p>
                <h3 className='text-xl sm:text-2xl font-semibold mt-1'>{value}</h3>
            </div>

            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${bgColor}`}>
                {icon}
            </div>
        </div>
    )
}
