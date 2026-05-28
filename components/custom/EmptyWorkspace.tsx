import Image from 'next/image'
import React from 'react'
import { Button } from '../ui/button'
import { Link } from 'lucide-react'

function EmptyWorkspace() {
    return (
        <div className='flex flex-col mt-8 sm:mt-10 items-center justify-center px-2'>
            <Image src={'/folder.png'} alt='folder' width={70} height={70} />
            <h2 className='font-medium text-xl sm:text-2xl mt-5 mb-4 text-center'>No Repository Connected</h2>
            <p className='text-center text-sm sm:text-base mx-2 sm:mx-10'>Connect your Github accounts and add a repository to generate and run test cases</p>

            <Button className='mt-5 w-full sm:w-auto'> <Link className='h-4 w-4 mr-2' /> Connect Repo </Button>

        </div>
    )
}

export default EmptyWorkspace
