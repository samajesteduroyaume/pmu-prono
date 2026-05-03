// No import needed for fetch in Node 22

async function test() {
    try {
        const res = await fetch('http://localhost:3000/api/courses');
        const data = await res.json();
        const courseId = data.data[0].id;
        console.log('Course ID:', courseId);

        const resP = await fetch(`http://localhost:3000/api/courses/${courseId}/participants`);
        const parts = await resP.json();
        console.log('First Participant:', JSON.stringify(parts[0], null, 2));
    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();
