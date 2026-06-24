import React, { useState } from 'react'
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
import { SettingsIcon } from 'lucide-react'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { TestCase } from './UserRepoList'
import axios from 'axios'

type props = {
    testCase?: TestCase,
    setReload: any
}

function TestCaseSettingDialog({ testCase, setReload }: props) {

    const [formTestCase, setFormTestCase] = useState({
        title: testCase?.title || '',
        description: testCase?.description || '',
        targetRoute: testCase?.targetRoute || '',
        expectedResult: testCase?.expectedResult || ''
    });



    const handleInputChange = (fieldName: string, value: string) => {

        setFormTestCase((prev) => ({
            ...prev,
            [fieldName]: value
        }))
    }

    const updateCase = async () => {
        const result = await axios.post('/api/test-cases/settings', {
            ...formTestCase,
            testCaseId: testCase?.id
        });
        console.log(result?.data);

        try {
            (window as any).pendo?.track("test_case_settings_updated", {
                test_case_id: testCase?.id,
                fields_updated: Object.keys(formTestCase).join(","),
            });
        } catch (e) { /* ignore tracking errors */ }

        setReload();
    }


    return (
        <Dialog>
            <DialogTrigger>
                <Button size={'icon'} variant={'outline'}>
                    <SettingsIcon className='h-4 w-4' />
                </Button>
            </DialogTrigger>
            <DialogContent className='w-[calc(100vw-1rem)] max-w-2xl p-4 sm:p-6'>
                <DialogHeader>
                    <DialogTitle>Edit Testing Requirements</DialogTitle>
                    <DialogDescription>
                        Modifying these parameters automatically clears pre-generated scripts to ensure synchronization.
                    </DialogDescription>
                </DialogHeader>

                <div>
                    <div className='mt-1'>
                        <label className='text-gray-500'>TEST TITLE</label>
                        <Input value={formTestCase?.title}
                            onChange={(event) => handleInputChange('title', event?.target?.value)}
                            placeholder='Test Title' className='mt-1' />
                    </div>
                    <div className='mt-5'>
                        <label className='text-gray-500'>DESCRIPTION/ACTION</label>
                        <Textarea
                            onChange={(event) => handleInputChange('description', event?.target?.value)}
                            value={formTestCase?.description} placeholder='Description' className='mt-1' />
                    </div>
                    <div className='mt-5'>
                        <label className='text-gray-500'>TARGET ROUTE/PATH</label>
                        <Input value={formTestCase?.targetRoute}
                            onChange={(event) => handleInputChange('targetRoute', event?.target?.value)}
                            placeholder='Target Route' className='mt-1' />
                    </div>
                    <div className='mt-5'>
                        <label className='text-gray-500'>EXPECTED RESULT</label>
                        <Textarea value={formTestCase?.expectedResult}
                            onChange={(event) => handleInputChange('expectedResult', event?.target?.value)}
                            placeholder='Expected Result' className='mt-1' />
                    </div>
                </div>
                <DialogFooter className='gap-2'>
                    <DialogClose asChild>
                        <Button className='w-full sm:w-auto' variant={'outline'}>
                            Cancel</Button></DialogClose>
                    <Button className='w-full sm:w-auto' onClick={updateCase}>Update Case</Button>
                </DialogFooter>
            </DialogContent>

        </Dialog>
    )
}

export default TestCaseSettingDialog
