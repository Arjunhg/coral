import React, { useEffect, useMemo, useRef, useState } from 'react'
import { TestCase } from './UserRepoList'
import { Checkbox } from '../ui/checkbox'
import { Badge } from '../ui/badge'
import { Play, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import TestCaseSettingDialog from './TestCaseSettingDialog'
import TestExecutionModal from './TestCaseExecutionModel'
import axios from 'axios'

type Props = {
    testCases: TestCase[],
    onReload: any,
    repository: any,
    voiceFilter: "all" | "passing" | "failing";
    voiceRunSignal: number;
    voiceRunScope: "all" | "failed" | "selected";
}
function TestCaseList({
    testCases,
    onReload,
    repository,
    voiceFilter,
    voiceRunSignal,
    voiceRunScope,
}: Props) {

    const [selectedTestCases, setSelectedTestCases] = useState<TestCase[]>([]);

    const [isModelOpen, setIsModelOpen] = useState(false);
    const [runQueue, setRunQueue] = useState<TestCase[]>([]);
    const [activeFilter, setActiveFilter] = useState<"all" | "passing" | "failing">("all");
    const lastVoiceSignalRef = useRef(voiceRunSignal);

    const filteredTestCases = useMemo(() => {
        if (activeFilter === "passing") {
            return testCases.filter((tc) => tc.status === "passed");
        }
        if (activeFilter === "failing") {
            return testCases.filter((tc) => tc.status === "failed");
        }
        return testCases;
    }, [activeFilter, testCases]);

    useEffect(() => {
        setActiveFilter(voiceFilter);
    }, [voiceFilter]);

    useEffect(() => {
        if (voiceRunSignal <= 0 || voiceRunSignal === lastVoiceSignalRef.current) return;
        lastVoiceSignalRef.current = voiceRunSignal;

        let targets: TestCase[] = [];
        if (voiceRunScope === "selected") {
            targets = selectedTestCases;
        } else if (voiceRunScope === "failed") {
            targets = testCases.filter((tc) => tc.status === "failed");
        } else {
            targets = filteredTestCases.length > 0 ? filteredTestCases : testCases;
        }

        if (targets.length === 0) return;

        setRunQueue(targets);
        setIsModelOpen(true);
    }, [voiceRunScope, voiceRunSignal, filteredTestCases, selectedTestCases, testCases]);

    const runSelectedTests = () => {
        if (selectedTestCases.length === 0) return;
        setRunQueue(selectedTestCases);
        setIsModelOpen(true);
    };

    const handleSelectedTestCase = (checked: boolean | string, testCase: TestCase) => {

        if (checked) {
            setSelectedTestCases((prev: any) => [...prev, testCase])
        }
        else {
            setSelectedTestCases((prev: any) => prev.filter((item: any) => item.id !== testCase.id))
        }
    }

    return (
        <div>
            <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2'>
                <h2 className='font-medium text-primary'>Generated Test Cases</h2>
                <div className='flex items-center gap-2 w-full sm:w-auto'>
                    <select
                        value={activeFilter}
                        onChange={(e) => setActiveFilter(e.target.value as "all" | "passing" | "failing")}
                        className='h-8 rounded-md border px-2 text-[11px] sm:text-xs bg-white w-full sm:w-auto'
                    >
                        <option value="all">All</option>
                        <option value="passing">Passing</option>
                        <option value="failing">Failing</option>
                    </select>
                    <Button size={'sm'} onClick={() => onReload(repository?.repoId)} className='shrink-0'> <RefreshCw className='h-3 w-3 mr-1' /> Refresh </Button>
                </div>
            </div>
            <div className='border rounded-md mt-3'>
                {filteredTestCases.map((testCase) => (
                    <div key={testCase.id} className='p-3 sm:p-4 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
                        <div className='flex gap-3 items-start sm:items-center min-w-0'>
                            <Checkbox
                                checked={selectedTestCases?.some((item: any) => item.id == testCase?.id)}
                                onCheckedChange={(checked) => handleSelectedTestCase(checked, testCase)} />
                            <div className='min-w-0'>
                                <h2 className='font-medium text-sm sm:text-base truncate'>{testCase?.title}</h2>
                                <p className='text-xs text-gray-500 line-clamp-2'>{testCase?.description}</p>
                            </div>
                        </div>
                        <div className='gap-1.5 sm:gap-4 flex flex-wrap items-center'>
                            <Badge variant={'secondary'} className='text-[10px] sm:text-xs'>{testCase?.type}</Badge>
                            {testCase?.status == 'failed' && <Badge variant={'destructive'} className='text-red-200 font-normal text-[10px] sm:text-xs'>{testCase?.status}</Badge>}
                            {testCase?.status == 'passed' && <Badge variant={'default'} className='text-green-200 font-normal bg-green-700 text-[10px] sm:text-xs'>{testCase?.status}</Badge>}
                            {testCase?.status == 'running' && <Badge variant={'default'} className='text-yellow-200 font-normal bg-yellow-700 text-[10px] sm:text-xs'>{testCase?.status}</Badge>}
                            {testCase?.status == 'generated' && <Badge variant={'secondary'} className='text-[10px] sm:text-xs'>{'Pending'}</Badge>}

                            <TestCaseSettingDialog testCase={testCase} setReload={() => onReload(repository?.repoId)} />

                        </div>
                    </div>
                ))}
                <div className='p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-gray-100'>
                    <h2 className='text-sm sm:text-base'>Run Selected Test Case</h2>
                    <Button className='w-full sm:w-auto' disabled={selectedTestCases?.length == 0} onClick={runSelectedTests}> <Play className='h-4 w-4 mr-2' />Run Test Cases</Button>
                </div>
            </div>

            <TestExecutionModal
                testCases={runQueue}
                repository={repository}
                isOpen={isModelOpen}
                onClose={async () => {
                    setIsModelOpen(false);
                    await onReload(repository?.repoId);
                }}
            />
        </div>
    )
}

export default TestCaseList
