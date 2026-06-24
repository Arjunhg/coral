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
import { Settings2 } from 'lucide-react'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { UserRepo } from './WorkspaceBody'
import axios from 'axios'

type props = {
    repo: UserRepo,
    setReload: () => void;
}
function RepoSettings({ repo, setReload }: props) {

    const [isOpen, setIsOpen] = useState(false);
    const [repoSettings, setRepoSettings] = useState({
        targetDomain: repo?.targetDomain || '',
        globalInstruction: repo?.gloablInstruction || ''
    });

    const handleSaveSettings = async () => {
        // Implement the logic to save the updated settings to the database
        // You can make an API call to update the repository settings in the backend
        console.log('Saved Settings:', repoSettings);

        const result = await axios.post('/api/user-repo/settings', {
            repoId: repo.repoId,
            targetDomain: repoSettings.targetDomain,
            globalInstruction: repoSettings.globalInstruction,
        });

        console.log(result?.data);

        try {
            (window as any).pendo?.track("repository_settings_saved", {
                repo_id: repo.repoId,
                has_target_domain: Boolean(repoSettings.targetDomain.trim()),
                has_global_instruction: Boolean(repoSettings.globalInstruction.trim()),
                target_domain: repoSettings.targetDomain.trim().substring(0, 100),
            });
        } catch (e) { /* ignore tracking errors */ }

        setIsOpen(false);
        setReload();

    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => setIsOpen(open)}>
            <DialogTrigger>
                <Button className='w-full sm:w-auto'> <Settings2 className='h-4 w-4 mr-1' /> Project Config</Button>
            </DialogTrigger>
            <DialogContent className='w-[calc(100vw-1rem)] max-w-2xl p-4 sm:p-6'>
                <DialogHeader>
                    <DialogTitle className='flex gap-2 items-center'> <Settings2 className='text-primary' /> Project/Repo Settings</DialogTitle>
                    <DialogDescription>
                        Configure project-level defaults used during script generation and execution.
                    </DialogDescription>
                </DialogHeader>
                <div>
                    <div>
                        <label className='text-gray-500'>APP URL/DEFAULT WEBSITE</label>
                        <Input value={repoSettings?.targetDomain}
                            onChange={(e) => setRepoSettings({ ...repoSettings, targetDomain: e.target.value })}
                            placeholder='App url/Domain' className='mt-1' />
                        <p className='text-xs text-gray-400'>The target address where automated headless browsers will connect and run test cases.</p>
                    </div>
                    <div className='mt-4'>
                        <label className='text-gray-500'>GLOBAL TEST INSTRUCTION</label>
                        <Textarea value={repoSettings?.globalInstruction}
                            onChange={(e) => setRepoSettings({ ...repoSettings, globalInstruction: e.target.value })}

                            placeholder='Instructions' className='mt-1' />
                        <p className='text-xs text-gray-400'>Include any authentication credentials, cookies, setup, or teardown instructions. These are automatically appended to AI prompts during test generation and runs.</p>
                    </div>
                </div>
                <DialogFooter className='gap-2'>
                    <DialogClose asChild>
                        <Button className='w-full sm:w-auto' variant={'outline'}>Cancel</Button>
                    </DialogClose>
                    <Button className='w-full sm:w-auto' onClick={handleSaveSettings}>Save Config</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default RepoSettings
